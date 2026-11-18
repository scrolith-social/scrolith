targetScope = 'resourceGroup'

@minLength(8)
@maxLength(16)
param prefix string

@minLength(1)
@description('Allowlisted reviewer/source IP ranges, in IPv4 CIDR format.')
param reviewerIngressCidrs string[]

@minLength(64)
@maxLength(64)
param frontendDigestHex string
@minLength(64)
@maxLength(64)
param apiDigestHex string
@minLength(64)
@maxLength(64)
param migratorDigestHex string

@description('Versions only, as given by the controlled Key Vault secret enrollment step.')
@minLength(32)
@maxLength(32)
param runtimeDatabaseVersion string
@minLength(32)
@maxLength(32)
param jwtVersion string
@minLength(32)
@maxLength(32)
param redisUrlVersion string
@minLength(32)
@maxLength(32)
param migratorDatabaseVersion string

@description('Deploy the migration job first. Enable apps only after successful migration, role finalization and data-plane verification.')
param startApplications bool = false

var location = 'southeastasia'
var suffix = uniqueString(resourceGroup().id)
var apiName = '${prefix}-api'
var frontendName = '${prefix}-web'

resource aca 'Microsoft.App/managedEnvironments@2026-01-01' existing = {
  name: '${prefix}-env'
}
resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: '${prefix}${take(suffix, 8)}'
}
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: '${prefix}-kv-${take(suffix, 4)}'
}
resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: '${prefix}${take(suffix, 8)}'
}
resource pull 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: '${prefix}-pull'
}
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: '${prefix}-api'
}
resource migratorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: '${prefix}-migrator'
}
resource redisIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: '${prefix}-redis'
}
var apiOrigin = 'https://${apiName}.${aca.properties.defaultDomain}'
var webOrigin = 'https://${frontendName}.${aca.properties.defaultDomain}'
var vaultUri = vault.properties.vaultUri
var vaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var apiSecretNames = ['runtime-database-url', 'jwt-signing-secret', 'redis-url']

resource apiSecrets 'Microsoft.KeyVault/vaults/secrets@2024-11-01' existing = [for secretName in apiSecretNames: {
  parent: vault
  name: secretName
}]
resource apiSecretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (secretName, i) in apiSecretNames: if (startApplications) {
  scope: apiSecrets[i]
  name: guid(apiSecrets[i].id, apiIdentity.id, vaultSecretsUserRole)
  properties: {
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: vaultSecretsUserRole
  }
}]

resource migratorSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' existing = {
  parent: vault
  name: 'migrator-database-url'
}
resource migratorSecretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: migratorSecret
  name: guid(migratorSecret.id, migratorIdentity.id, vaultSecretsUserRole)
  properties: {
    principalId: migratorIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: vaultSecretsUserRole
  }
}

resource migrator 'Microsoft.App/jobs@2026-01-01' = {
  name: '${prefix}-migrate'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pull.id}': {}
      '${migratorIdentity.id}': {}
    }
  }
  properties: {
    environmentId: aca.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: pull.id
        }
      ]
      secrets: [
        {
          name: 'migrator-database-url'
          keyVaultUrl: '${vaultUri}secrets/migrator-database-url/${migratorDatabaseVersion}'
          identity: migratorIdentity.id
        }
      ]
      identitySettings: [
        { identity: pull.id, lifecycle: 'None' }
        { identity: migratorIdentity.id, lifecycle: 'None' }
      ]
    }
    template: {
      containers: [
        {
          name: 'prisma-migrator'
          image: '${registry.properties.loginServer}/scrolith-migrator@sha256:${migratorDigestHex}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'DATABASE_URL', secretRef: 'migrator-database-url' }
          ]
        }
      ]
    }
  }
  dependsOn: [migratorSecretAccess]
}

module api './api-containerapp-single-replica.bicep' = if (startApplications) {
  name: '${prefix}-api-workload'
  params: {
    apiAppName: apiName
    location: location
    managedEnvironmentResourceId: aca.id
    acrLoginServer: registry.properties.loginServer
    apiImageRepository: 'scrolith-api'
    apiImageDigestHex: apiDigestHex
    acrPullIdentityResourceId: pull.id
    apiIdentityResourceId: apiIdentity.id
    redisIdentityResourceId: redisIdentity.id
    runtimeDatabaseUrlSecretUri: '${vaultUri}secrets/runtime-database-url/${runtimeDatabaseVersion}'
    jwtSecretUri: '${vaultUri}secrets/jwt-signing-secret/${jwtVersion}'
    redisUrlSecretUri: '${vaultUri}secrets/redis-url/${redisUrlVersion}'
    blobAccountUrl: storage.properties.primaryEndpoints.blob
    publicApiUrl: apiOrigin
    frontendOrigin: webOrigin
    corsAllowedOrigins: webOrigin
    allowedIngressCidrs: reviewerIngressCidrs
    apiIdentityClientId: apiIdentity.properties.clientId
    redisIdentityClientId: redisIdentity.properties.clientId
    redisIdentityObjectId: redisIdentity.properties.principalId
  }
  dependsOn: [apiSecretAccess]
}

resource frontend 'Microsoft.App/containerApps@2026-01-01' = if (startApplications) {
  name: frontendName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pull.id}': {} }
  }
  properties: {
    managedEnvironmentId: aca.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
        ipSecurityRestrictions: [for (cidr, i) in reviewerIngressCidrs: {
          name: 'reviewer-${i}'
          ipAddressRange: cidr
          action: 'Allow'
        }]
      }
      registries: [
        { server: registry.properties.loginServer, identity: pull.id }
      ]
      identitySettings: [
        { identity: pull.id, lifecycle: 'None' }
      ]
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: '${registry.properties.loginServer}/scrolith-frontend@sha256:${frontendDigestHex}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/', port: 8080 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/', port: 8080 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
}

output apiUrl string = apiOrigin
output frontendUrl string = webOrigin
output migrationJobId string = migrator.id
