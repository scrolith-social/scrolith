targetScope = 'resourceGroup'

@description('Name of the already-approved API Container App.')
param apiAppName string

@description('Region of the existing Container Apps environment.')
param location string

@description('Resource ID of the existing Container Apps environment.')
param managedEnvironmentResourceId string

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

@description('HTTPS internal FQDN of the Scrolitha Core Container App in the same Container Apps environment.')
param scrolithaCoreEndpoint string

@description('Model bundled in the reviewed Scrolitha Core image. The current 8 GiB profile is sized for qwen3:8b.')
@allowed(['qwen3:8b'])
param scrolithaCoreModel string = 'qwen3:8b'

var apiImage = '${acrLoginServer}/${apiImageRepository}@sha256:${apiImageDigestHex}'

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
            { name: 'SCROLITHA_PROVIDER', value: 'core' }
            { name: 'SCROLITHA_CORE_ENDPOINT', value: scrolithaCoreEndpoint }
            { name: 'SCROLITHA_CORE_MODEL', value: scrolithaCoreModel }
            { name: 'SCROLITHA_CORE_SIDECAR_MODE', value: 'false' }
            { name: 'SCROLITHA_AI_LOCAL_ONLY', value: 'true' }
            { name: 'SCROLITHA_AI_ALLOWED_PROVIDERS', value: 'OLLAMA' }
            { name: 'SCROLITHA_AI_OLLAMA_ENABLED', value: 'false' }
            { name: 'SCROLITHA_AI_NATIVE_PROVIDER_ENABLED', value: 'false' }
            { name: 'SCROLITHA_AI_ENABLE_PROVIDER_CALLS', value: 'false' }
            { name: 'SCROLITHA_AI_ALLOW_PROD_PROVIDER', value: '0' }
            { name: 'SCROLITHA_AI_FORCE_NO_EXTERNAL_PROVIDER', value: '1' }
            { name: 'SCROLITHA_AI_DEFAULT_PROVIDER', value: 'OLLAMA' }
            { name: 'SCROLITHA_AI_DEFAULT_MODEL', value: scrolithaCoreModel }
            { name: 'SCROLITHA_OLLAMA_MODEL', value: scrolithaCoreModel }
            { name: 'SCROLITHA_TIMEOUT_MS', value: '180000' }
            { name: 'SCROLITHA_MAX_TOKENS', value: '1024' }
            { name: 'SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS', value: '500000' }
            { name: 'SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS', value: '1000' }
            { name: 'SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS', value: '180000' }
            { name: 'DATABASE_URL', secretRef: 'runtime-database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-signing-secret' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
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
