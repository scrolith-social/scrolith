targetScope = 'resourceGroup'

@description('Unique 8-16 character lowercase alphanumeric pilot resource prefix.')
@minLength(8)
@maxLength(16)
param prefix string

@description('Dedicated PostgreSQL bootstrap administrator. Never used by the API or migrator.')
param postgresAdmin string

@secure()
@description('Supplied by the approved deployment secret channel.')
param postgresAdminPassword string

@description('Reviewed Redis ACL for the API. Use a dedicated isolated instance and validate commands in staging.')
@minLength(1)
param redisApiAccessString string

@description('Enable two-node Managed Redis. Disabling requires a staging-only availability decision.')
param redisHa bool = true

var location = 'southeastasia'
var suffix = uniqueString(resourceGroup().id)
var storageName = '${prefix}${take(suffix, 8)}'

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.86.0.0/16']
    }
  }
}

resource acaSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'apps'
  properties: {
    addressPrefix: '10.86.0.0/24'
    delegations: [
      {
        name: 'container-apps'
        properties: { serviceName: 'Microsoft.App/environments' }
      }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'postgres'
  properties: {
    addressPrefix: '10.86.1.0/27'
    delegations: [
      {
        name: 'postgres-flexible'
        properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
      }
    ]
  }
  dependsOn: [acaSubnet]
}

resource endpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'private-endpoints'
  properties: {
    addressPrefix: '10.86.2.0/26'
    privateEndpointNetworkPolicies: 'Disabled'
  }
  dependsOn: [postgresSubnet]
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2026-01-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    publicNetworkAccess: 'Enabled'
    vnetConfiguration: {
      infrastructureSubnetId: acaSubnet.id
      internal: false
    }
    appLogsConfiguration: { destination: 'azure-monitor' }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
  dependsOn: [endpointSubnet]
}

resource appDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: env
  name: 'container-apps-logs'
  properties: {
    workspaceId: logs.id
    logs: [
      {
        category: 'ContainerAppConsoleLogs'
        enabled: true
      }
      {
        category: 'ContainerAppSystemLogs'
        enabled: true
      }
    ]
  }
}

resource postgresZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}.private.postgres.database.azure.com'
  location: 'global'
}

resource postgresLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresZone
  name: 'pilot-network'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: '${prefix}-pg-${take(suffix, 5)}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '17'
    administratorLogin: postgresAdmin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresZone.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [postgresLink, endpointSubnet]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: 'scrolith_pilot'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource redis 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: '${prefix}-redis-${take(suffix, 5)}'
  location: location
  sku: { name: 'Balanced_B0' }
  properties: {
    highAvailability: redisHa ? 'Enabled' : 'Disabled'
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource redisDb 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  parent: redis
  name: 'default'
  properties: {
    accessKeysAuthentication: 'Disabled'
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'NoCluster'
    evictionPolicy: 'NoEviction'
    modules: []
    port: 10000
  }
}

resource blob 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: blob
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
  }
}

resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'uploads'
  properties: { publicAccess: 'None' }
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: storageName
  location: location
  sku: { name: 'Premium' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Disabled'
    networkRuleBypassOptions: 'None'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: '${prefix}-kv-${take(suffix, 4)}'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    softDeleteRetentionInDays: 90
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
  }
}

var privateServices = [
  { group: 'blob', zone: 'privatelink.blob.${environment().suffixes.storage}', id: blob.id }
  { group: 'redisEnterprise', zone: 'privatelink.redis.azure.net', id: redis.id }
  { group: 'registry', zone: 'privatelink.azurecr.io', id: registry.id }
  { group: 'vault', zone: 'privatelink.vaultcore.azure.net', id: vault.id }
]

module privateEndpoints './pilot-private-endpoint.bicep' = [for service in privateServices: {
  name: '${prefix}-${service.group}-private'
  params: {
    name: '${prefix}-${service.group}'
    location: location
    connectionId: service.id
    group: service.group
    zone: service.zone
    vnetId: vnet.id
    subnetId: endpointSubnet.id
  }
}]

var identityKinds = ['pull', 'api', 'migrator', 'redis']
resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = [for kind in identityKinds: {
  name: '${prefix}-${kind}'
  location: location
}]

resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identities[0].id, 'AcrPull')
  properties: {
    principalId: identities[0].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource apiBlobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: uploads
  name: guid(uploads.id, identities[1].id, 'Storage Blob Data Contributor')
  properties: {
    principalId: identities[1].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource redisAccess 'Microsoft.Cache/redisEnterprise/databases/accessPolicyAssignments@2026-05-01-preview' = {
  parent: redisDb
  name: '${prefix}-api'
  properties: {
    accessPolicyName: 'default'
    accessString: redisApiAccessString
    user: { objectId: identities[3].properties.principalId }
  }
}

output containerAppsEnvironmentId string = env.id
output containerAppsDefaultDomain string = env.properties.defaultDomain
output registryLoginServer string = registry.properties.loginServer
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresDatabase string = database.name
output redisHost string = redis.properties.hostName
output blobAccountUrl string = blob.properties.primaryEndpoints.blob
output vaultName string = vault.name
output pullIdentityId string = identities[0].id
output apiIdentityId string = identities[1].id
output migratorIdentityId string = identities[2].id
output redisIdentityId string = identities[3].id
