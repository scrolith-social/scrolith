targetScope = 'resourceGroup'

@description('Name of the dedicated Scrolitha Core Container App.')
param coreAppName string = 'ca-scrolitha-core-sea-prod'

@description('Region of the existing Container Apps environment.')
param location string

@description('Resource ID of the existing Container Apps environment.')
param managedEnvironmentResourceId string

@description('ACR login server containing the reviewed Core image.')
param acrLoginServer string

@description('Repository path for the Core image, without tag or digest.')
param coreImageRepository string = 'scrolitha-core'

@minLength(64)
@maxLength(64)
@description('Lowercase hexadecimal SHA-256 digest of the reviewed Core image.')
param coreImageDigestHex string

@description('Resource ID of the existing UAMI with AcrPull scoped to the selected ACR.')
param acrPullIdentityResourceId string

@description('Only qwen3:8b is supported by the current 4 vCPU / 8 GiB Consumption profile.')
@allowed(['qwen3:8b'])
param model string = 'qwen3:8b'

var coreImage = '${acrLoginServer}/${coreImageRepository}@sha256:${coreImageDigestHex}'

resource coreApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: coreAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acrPullIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentResourceId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: acrPullIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ollama-core'
          image: coreImage
          resources: {
            cpu: json('4.0')
            memory: '8Gi'
          }
          env: [
            { name: 'OLLAMA_HOST', value: '0.0.0.0:8080' }
            { name: 'OLLAMA_MODELS', value: '/models' }
            { name: 'SCROLITHA_OLLAMA_MODEL', value: model }
            { name: 'OLLAMA_CONTEXT_LENGTH', value: '4096' }
            { name: 'OLLAMA_MAX_LOADED_MODELS', value: '1' }
            { name: 'OLLAMA_NUM_PARALLEL', value: '1' }
            { name: 'OLLAMA_KEEP_ALIVE', value: '30m' }
            { name: 'OLLAMA_NO_CLOUD', value: '1' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/api/tags'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/tags'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/tags'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output coreContainerAppResourceId string = coreApp.id
output coreInternalFqdn string = coreApp.properties.configuration.ingress.fqdn
