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

@description('Name of the separate private scanner Container App. It must be in the same Container Apps environment as the API.')
param scannerAppName string

@description('Resource ID of the scanner UAMI. Grant it only AcrPull and access to the scanner TLS secrets.')
param scannerIdentityResourceId string

@description('Mirrored ClamAV repository in the reviewed ACR.')
param clamAvImageRepository string

@minLength(64)
@maxLength(64)
@description('Lowercase hexadecimal SHA-256 digest of the exact mirrored official ClamAV image.')
param clamAvImageDigestHex string

@description('Scanner TLS bridge repository in the reviewed ACR.')
param scannerBridgeImageRepository string

@minLength(64)
@maxLength(64)
@description('Lowercase hexadecimal SHA-256 digest of the reviewed scanner TLS bridge image.')
param scannerBridgeImageDigestHex string

@description('TLS DNS name present in the scanner bridge certificate SAN.')
param scannerTlsServerName string

@secure()
@description('Versioned Key Vault URI for the scanner TLS server certificate (base64 PEM).')
param scannerTlsServerCertSecretUri string

@secure()
@description('Versioned Key Vault URI for the scanner TLS server private key (base64 PEM).')
param scannerTlsServerKeySecretUri string

@secure()
@description('Versioned Key Vault URI for the scanner client CA certificate (base64 PEM).')
param scannerTlsClientCaSecretUri string

@secure()
@description('Versioned Key Vault URI for the API trust CA certificate (base64 PEM).')
param apiTlsCaSecretUri string

@secure()
@description('Versioned Key Vault URI for the API mTLS client certificate (base64 PEM).')
param apiTlsClientCertSecretUri string

@secure()
@description('Versioned Key Vault URI for the API mTLS client private key (base64 PEM).')
param apiTlsClientKeySecretUri string

@allowed([
  'true'
  'false'
])
@description('Exact existing SCROLITH_MONEY_MOVEMENT_ENABLED value on the API app; required so this ClamAV rollout preserves the current setting.')
param moneyMovementEnabled string

var apiImage = '${acrLoginServer}/${apiImageRepository}@sha256:${apiImageDigestHex}'
var clamAvImage = '${acrLoginServer}/${clamAvImageRepository}@sha256:${clamAvImageDigestHex}'
var scannerBridgeImage = '${acrLoginServer}/${scannerBridgeImageRepository}@sha256:${scannerBridgeImageDigestHex}'

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
        {
          name: 'clamav-client-ca'
          keyVaultUrl: apiTlsCaSecretUri
          identity: apiIdentityResourceId
        }
        {
          name: 'clamav-client-certificate'
          keyVaultUrl: apiTlsClientCertSecretUri
          identity: apiIdentityResourceId
        }
        {
          name: 'clamav-client-private-key'
          keyVaultUrl: apiTlsClientKeySecretUri
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
            { name: 'CLAMAV_MODE', value: 'tcp_tls' }
            { name: 'CLAMAV_HOST', value: scannerAppName }
            { name: 'CLAMAV_PORT', value: '13310' }
            { name: 'CLAMAV_TLS_SERVER_NAME', value: scannerTlsServerName }
            { name: 'CLAMAV_TLS_CA_B64', secretRef: 'clamav-client-ca' }
            { name: 'CLAMAV_TLS_CLIENT_CERT_B64', secretRef: 'clamav-client-certificate' }
            { name: 'CLAMAV_TLS_CLIENT_KEY_B64', secretRef: 'clamav-client-private-key' }
            { name: 'CLAMAV_FAIL_OPEN', value: 'false' }
            { name: 'CLAMAV_TIMEOUT_MS', value: '15000' }
            { name: 'CLAMAV_RETRIES', value: '1' }
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

// The API and ClamAV no longer share an app replica. The scanner app remains
// private to this environment and only exposes the mTLS bridge port; clamd is
// bound to loopback and is never ingress-addressable.
resource scannerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: scannerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acrPullIdentityResourceId}': {}
      '${scannerIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentResourceId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 13310
        exposedPort: 13310
        transport: 'tcp'
      }
      registries: [
        {
          server: acrLoginServer
          identity: acrPullIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'scanner-server-certificate'
          keyVaultUrl: scannerTlsServerCertSecretUri
          identity: scannerIdentityResourceId
        }
        {
          name: 'scanner-server-private-key'
          keyVaultUrl: scannerTlsServerKeySecretUri
          identity: scannerIdentityResourceId
        }
        {
          name: 'scanner-client-ca'
          keyVaultUrl: scannerTlsClientCaSecretUri
          identity: scannerIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'clamav'
          image: clamAvImage
          resources: {
            cpu: json('1.75')
            memory: '3.5Gi'
          }
          env: [
            { name: 'CLAMAV_NO_MILTERD', value: 'true' }
            { name: 'CLAMD_CONF_TCPAddr', value: '127.0.0.1' }
            { name: 'CLAMD_CONF_MaxThreads', value: '2' }
            { name: 'CLAMD_CONF_MaxQueue', value: '4' }
          ]
        }
        {
          name: 'mtls-bridge'
          image: scannerBridgeImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'CLAMD_UPSTREAM_ADDRESS', value: '127.0.0.1:3310' }
            { name: 'BRIDGE_TLS_ADDRESS', value: '0.0.0.0:13310' }
            { name: 'BRIDGE_HEALTH_ADDRESS', value: '0.0.0.0:8080' }
            { name: 'BRIDGE_MAX_CLIENTS', value: '4' }
            { name: 'BRIDGE_MAX_INSTREAM_BYTES', value: '10485760' }
            { name: 'BRIDGE_IDLE_TIMEOUT_MS', value: '45000' }
            { name: 'BRIDGE_TLS_SERVER_CERT_B64', secretRef: 'scanner-server-certificate' }
            { name: 'BRIDGE_TLS_SERVER_KEY_B64', secretRef: 'scanner-server-private-key' }
            { name: 'BRIDGE_TLS_CLIENT_CA_B64', secretRef: 'scanner-client-ca' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/startupz'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 1
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 20
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/readyz'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 30
              timeoutSeconds: 3
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
output scannerContainerAppResourceId string = scannerApp.id
