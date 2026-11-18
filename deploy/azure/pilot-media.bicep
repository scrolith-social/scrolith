targetScope = 'resourceGroup'
@minLength(8)
@maxLength(16)
param prefix string
@minLength(64)
@maxLength(64)
param workerDigestHex string
@minLength(64)
@maxLength(64)
@description('Reviewed scanner image mirrored into the private ACR; never use a floating tag.')
param scannerDigestHex string
@minLength(32)
@maxLength(32)
param dispatcherDatabaseVersion string
@minLength(32)
@maxLength(32)
param workerDatabaseVersion string

var suffix = uniqueString(resourceGroup().id)
resource env 'Microsoft.App/managedEnvironments@2026-01-01' existing = { name: '${prefix}-env' }
resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = { name: '${prefix}${take(suffix, 8)}' }
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = { name: '${prefix}-kv-${take(suffix, 4)}' }
resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = { name: '${prefix}${take(suffix, 8)}' }
resource pull 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: '${prefix}-pull' }
var names = ['media-dispatch', 'media-worker', 'media-scale']
resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = [for name in names: { name: '${prefix}-${name}' }]
var secretNames = ['media-dispatch-database-url', 'media-worker-database-url']
resource secrets 'Microsoft.KeyVault/vaults/secrets@2024-11-01' existing = [for name in secretNames: { parent: vault, name: name }]
resource secretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (name, i) in secretNames: {
  scope: secrets[i]
  name: guid(secrets[i].id, identities[i].id, 'secrets-user')
  properties: {
    principalId: identities[i].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}]

// Private TCP endpoint, no HTTP/public ingress or credential. Scan data never leaves the environment.
// Definition freshness and outbound update destinations require deployed acceptance checks.
resource scanner 'Microsoft.App/containerApps@2026-01-01' = {
  name: '${prefix}-scan'
  location: 'southeastasia'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pull.id}': {} } }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registry.properties.loginServer, identity: pull.id }]
      identitySettings: [{ identity: pull.id, lifecycle: 'None' }]
      ingress: { external: false, transport: 'tcp', targetPort: 3310, exposedPort: 3310 }
    }
    template: {
      containers: [{
        name: 'clamd'
        image: '${registry.properties.loginServer}/scrolith-scanner@sha256:${scannerDigestHex}'
        resources: { cpu: json('2.0'), memory: '4Gi' }
        // Reviewed official ClamAV entrypoint contract. A different scanner image
        // must implement these limits and signed-definition update settings.
        env: [
          { name: 'CLAMD_CONF_StreamMaxLength', value: '250M' }
          { name: 'CLAMD_CONF_MaxFileSize', value: '250M' }
          { name: 'CLAMD_CONF_MaxScanSize', value: '500M' }
          { name: 'CLAMD_CONF_MaxScanTime', value: '120000' }
          { name: 'CLAMD_CONF_MaxThreads', value: '2' }
          { name: 'CLAMD_CONF_MaxQueue', value: '4' }
          { name: 'CLAMD_CONF_ConcurrentDatabaseReload', value: 'no' }
          { name: 'CLAMD_CONF_AlertExceedsMax', value: 'yes' }
          { name: 'CLAMD_CONF_SelfCheck', value: '60' }
          { name: 'FRESHCLAM_CHECKS', value: '12' }
          { name: 'FRESHCLAM_CONF_TestDatabases', value: 'yes' }
        ]
        probes: [
          { type: 'Startup', tcpSocket: { port: 3310 }, periodSeconds: 10, failureThreshold: 60 }
          { type: 'Readiness', tcpSocket: { port: 3310 }, periodSeconds: 10 }
          { type: 'Liveness', tcpSocket: { port: 3310 }, periodSeconds: 30 }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

var modes = ['dispatch', 'consume']
resource jobs 'Microsoft.App/jobs@2026-01-01' = [for (mode, i) in modes: {
  name: '${prefix}-media-${mode}'
  location: 'southeastasia'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pull.id}': {}, '${identities[i].id}': {}, '${identities[2].id}': {} }
  }
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: i == 0 ? 'Schedule' : 'Event'
      replicaTimeout: i == 0 ? 55 : 900
      replicaRetryLimit: 0
      scheduleTriggerConfig: i == 0 ? { cronExpression: '* * * * *', parallelism: 1, replicaCompletionCount: 1 } : null
      eventTriggerConfig: i == 1 ? {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 2
          pollingInterval: 30
          rules: [{
            name: 'private-media-queue'
            type: 'azure-queue'
            identity: identities[2].id
            metadata: { accountName: storage.name, queueName: 'media-processing', queueLength: '1' }
          }]
        }
      } : null
      registries: [{ server: registry.properties.loginServer, identity: pull.id }]
      secrets: [{
        name: 'database-url'
        identity: identities[i].id
        keyVaultUrl: '${vault.properties.vaultUri}secrets/${secretNames[i]}/${i == 0 ? dispatcherDatabaseVersion : workerDatabaseVersion}'
      }]
      identitySettings: [
        { identity: pull.id, lifecycle: 'None' }
        { identity: identities[2].id, lifecycle: 'None' }
        { identity: identities[i].id, lifecycle: 'Main' }
      ]
    }
    template: {
      containers: [{
        name: 'media-${mode}'
        image: '${registry.properties.loginServer}/scrolith-media-worker@sha256:${workerDigestHex}'
        command: ['node', 'dist/azureMediaJob.server.js']
        args: [mode]
        resources: { cpu: i == 0 ? json('0.25') : json('1.0'), memory: i == 0 ? '0.5Gi' : '2Gi' }
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'DATABASE_URL', secretRef: 'database-url' }
          { name: 'PRISMA_CONNECTION_LIMIT', value: '2' }
          { name: 'MEDIA_PROCESSING_MODE', value: 'azure_queue' }
          { name: 'MEDIA_WORKER_SERVICE', value: 'true' }
          { name: 'MEDIA_IMAGE_PROCESSING_ENABLED', value: 'true' }
          { name: 'MEDIA_VIDEO_PROCESSING_ENABLED', value: 'true' }
          { name: 'SCROLITH_MONEY_MOVEMENT_ENABLED', value: 'false' }
          { name: 'EXTERNAL_PLATFORM_API_ENABLED', value: 'false' }
          { name: 'AZURE_MEDIA_QUEUE_ACCOUNT_URL', value: 'https://${storage.name}.queue.${environment().suffixes.storage}' }
          { name: 'AZURE_MEDIA_QUEUE_NAME', value: 'media-processing' }
          { name: 'AZURE_MEDIA_POISON_QUEUE_NAME', value: 'media-review' }
          { name: 'AZURE_MEDIA_IDENTITY_CLIENT_ID', value: identities[i].properties.clientId }
          { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
          { name: 'AZURE_STORAGE_CONTAINER', value: 'uploads' }
          { name: 'AZURE_STORAGE_AUTH_MODE', value: 'managed_identity' }
          { name: 'AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID', value: identities[i].properties.clientId }
          { name: 'CLAMAV_MODE', value: 'tcp' }
          { name: 'CLAMAV_HOST', value: scanner.name }
          { name: 'CLAMAV_PORT', value: '3310' }
          { name: 'CLAMAV_FAIL_OPEN', value: 'false' }
          // A real local 250 MiB clean scan exceeded the shared 15-second
          // default. Bound the media scan within the 180-second renewable lease.
          { name: 'CLAMAV_TIMEOUT_MS', value: '120000' }
          { name: 'CLAMAV_RETRIES', value: '0' }
        ]
      }]
    }
  }
  dependsOn: [secretAccess]
}]
output dispatcherJobId string = jobs[0].id
output workerJobId string = jobs[1].id
