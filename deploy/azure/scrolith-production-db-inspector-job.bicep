targetScope = 'resourceGroup'

@description('Existing production Container Apps environment; this template never creates an environment.')
@allowed([
  'cae-scrolith-sea-prod'
])
param environmentName string = 'cae-scrolith-sea-prod'

@description('Pinned final inspector image digest in the production ACR; provide the full sha256:<64 hex> value.')
@minLength(71)
@maxLength(71)
param inspectorImageDigest string

@description('Existing managed identity with AcrPull scoped to the production ACR.')
param acrPullIdentityResourceId string = '/subscriptions/d256e51d-950a-4141-9209-462302844a14/resourceGroups/rg-scrolith-sea-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-scrolith-aca-acrpull'

@description('Dedicated UAMI authorized to resolve only the versioned inspector password secret in Key Vault. Must be separately provisioned and reviewed.')
param inspectorKeyVaultIdentityResourceId string

@description('Versioned Key Vault secret URI for the scrolith_inspector password. The value is never passed to this template.')
param inspectorPasswordSecretVersionUri string

@description('Explicit production resource name; kept fixed to the inspected server.')
@allowed([
  'psql-scrolith-prod-sea-2026.postgres.database.azure.com'
])
param postgresHost string = 'psql-scrolith-prod-sea-2026.postgres.database.azure.com'

@description('The secret object name inside the Container Apps Job. Not a secret value.')
param containerSecretName string = 'pg-inspector-password'

var registryServer = 'scrolithprodsea2026.azurecr.io'
var imageName = '${registryServer}/scrolith-tools/postgres-inspector@${inspectorImageDigest}'

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: environmentName
}

resource inspectorJob 'Microsoft.App/jobs@2026-01-01' = {
  name: 'job-scrolith-prod-db-inspector'
  location: 'southeastasia'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acrPullIdentityResourceId}': {}
      '${inspectorKeyVaultIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaRetryLimit: 0
      replicaTimeout: 120
      registries: [
        {
          server: registryServer
          identity: acrPullIdentityResourceId
        }
      ]
      secrets: [
        {
          name: containerSecretName
          keyVaultUrl: inspectorPasswordSecretVersionUri
          identity: inspectorKeyVaultIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'inspect'
          image: imageName
          resources: {
            cpu: 1
            memory: '2Gi'
          }
          env: [
            { name: 'PGHOST', value: postgresHost }
            { name: 'PGPORT', value: '5432' }
            { name: 'PGDATABASE', value: 'scrolith' }
            { name: 'PGUSER', value: 'scrolith_inspector' }
            { name: 'PGSSLMODE', value: 'verify-full' }
            { name: 'PGSSLROOTCERT', value: '/etc/ssl/certs/ca-certificates.crt' }
            { name: 'PGCONNECT_TIMEOUT', value: '10' }
            { name: 'PGAPPNAME', value: 'scrolith-production-readonly-inspector' }
            { name: 'PGPASSWORD', secretRef: containerSecretName }
          ]
        }
      ]
    }
  }
}

output inspectorJobResourceId string = inspectorJob.id
