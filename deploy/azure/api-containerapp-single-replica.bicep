targetScope = 'resourceGroup'

@description('Name of the already-approved API Container App.')
param apiAppName string

@description('Region of the existing Container Apps environment.')
param location string

@description('Resource ID of the existing Container Apps environment.')
param managedEnvironmentResourceId string

@description('Exact existing custom-domain bindings for the API ingress; pass the current objects unchanged.')
param apiCustomDomains array

@description('ACR login server containing the reviewed API image.')
param acrLoginServer string

@description('Repository path in ACR, without tag or digest.')
param apiImageRepository string

@minLength(64)
@maxLength(64)
@description('Lowercase hexadecimal SHA-256 digest of the reviewed API image.')
param apiImageDigestHex string

@description('Resource ID of the existing UAMI with AcrPull only on the selected ACR.')
param acrPullIdentityResourceId string

@description('Resource ID of the API UAMI. It needs scoped Key Vault Secrets User and Storage Blob Data Contributor roles.')
param apiIdentityResourceId string

@description('Resource ID of the dedicated Redis Entra UAMI. It needs only the approved Redis data-plane role.')
param redisIdentityResourceId string

@secure()
@description('Versioned Key Vault secret URI for the runtime-only database connection URL.')
param runtimeDatabaseUrlSecretUri string

@secure()
@description('Versioned Key Vault secret URI for the API JWT signing secret.')
param jwtSecretUri string

@secure()
@description('Versioned Key Vault secret URI for the Redis TLS connection URI.')
param redisUrlSecretUri string

@description('Storage account endpoint; not a credential.')
param blobAccountUrl string

@description('API public origin, such as https://api.scrolith.com.')
param publicApiUrl string

@description('Canonical frontend origin.')
param frontendOrigin string

@description('Comma-separated, exact approved browser origins.')
param corsAllowedOrigins string

@description('Client ID of the API user-assigned identity for Blob access.')
param apiIdentityClientId string

@description('Client ID used by the API Redis Entra integration.')
param redisIdentityClientId string

@description('Object ID used by the API Redis Entra integration.')
param redisIdentityObjectId string

@allowed([
  'true'
  'false'
])
@description('Exact existing SCROLITH_MONEY_MOVEMENT_ENABLED value on the API app; required so this ClamAV rollout preserves the current setting.')
param moneyMovementEnabled string

var apiImage = '${acrLoginServer}/${apiImageRepository}@sha256:${apiImageDigestHex}'
// Cisco Talos official ClamAV 1.5.5 image, pinned to the reviewed linux/amd64 digest.
var clamAvImage = 'clamav/clamav@sha256:64e30c0bf976198024deb3dc6d5cfe2485fb969c0f73549ba0fdb364b9469614'

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acrPullIdentityResourceId}': {}
      '${apiIdentityResourceId}': {}
      '${redisIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentResourceId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 5000
        transport: 'auto'
        allowInsecure: false
        customDomains: apiCustomDomains
      }
      registries: [
        {
          server: acrLoginServer
          identity: acrPullIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'runtime-database-url'
          keyVaultUrl: runtimeDatabaseUrlSecretUri
          identity: apiIdentityResourceId
        }
        {
          name: 'jwt-signing-secret'
          keyVaultUrl: jwtSecretUri
          identity: apiIdentityResourceId
        }
        {
          name: 'redis-url'
          keyVaultUrl: redisUrlSecretUri
          identity: apiIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 5000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/readyz'
                port: 5000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '5000' }
            { name: 'FRONTEND_URL', value: frontendOrigin }
            { name: 'FRONTEND_ORIGIN', value: frontendOrigin }
            { name: 'PUBLIC_APP_URL', value: frontendOrigin }
            { name: 'PUBLIC_API_URL', value: publicApiUrl }
            { name: 'BACKEND_PUBLIC_URL', value: publicApiUrl }
            { name: 'CORS_ALLOWED_ORIGINS', value: corsAllowedOrigins }
            { name: 'UPLOAD_DRIVER', value: 'azure_blob' }
            { name: 'AZURE_STORAGE_AUTH_MODE', value: 'managed_identity' }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: blobAccountUrl }
            { name: 'AZURE_STORAGE_CONTAINER', value: 'uploads' }
            { name: 'AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID', value: apiIdentityClientId }
            { name: 'REDIS_ENTRA_CLIENT_ID', value: redisIdentityClientId }
            { name: 'REDIS_ENTRA_OBJECT_ID', value: redisIdentityObjectId }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-signing-secret' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            { name: 'SCROLITH_MONEY_MOVEMENT_ENABLED', value: moneyMovementEnabled }
            { name: 'CLAMAV_MODE', value: 'tcp' }
            { name: 'CLAMAV_HOST', value: '127.0.0.1' }
            { name: 'CLAMAV_PORT', value: '3310' }
            { name: 'CLAMAV_FAIL_OPEN', value: 'false' }
            { name: 'CLAMAV_TIMEOUT_MS', value: '15000' }
            { name: 'CLAMAV_RETRIES', value: '1' }
          ]
        }
        {
          name: 'clamav'
          image: clamAvImage
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          env: [
            { name: 'CLAMAV_NO_MILTERD', value: 'true' }
            { name: 'CLAMD_CONF_TCPAddr', value: '127.0.0.1' }
            { name: 'CLAMD_CONF_MaxThreads', value: '2' }
            { name: 'CLAMD_CONF_MaxQueue', value: '4' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health/clamav'
                port: 5000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 1
              periodSeconds: 60
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health/clamav'
                port: 5000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output apiContainerAppResourceId string = apiApp.id
