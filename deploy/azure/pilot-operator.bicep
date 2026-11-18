targetScope = 'resourceGroup'
@minLength(8)
@maxLength(16)
param prefix string
@description('Exact reviewed Canonical image version, verified with az vm image show; never latest.')
@minLength(6)
param ubuntuImageVersion string
@description('Operator-owned public SSH key only. Private keys never enter this template.')
@minLength(40)
param operatorSshPublicKey string
@minLength(5)
@maxLength(32)
param operatorUsername string
var location = 'southeastasia'
var suffix = uniqueString(resourceGroup().id)
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = { name: '${prefix}-vnet' }
resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = { name: '${prefix}${take(suffix, 8)}' }
resource operatorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-operator'
  location: location
}
resource acrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, operatorIdentity.id, 'AcrPush')
  properties: {
    principalId: operatorIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','8311e382-0749-4cb8-b61a-304f252e45ec')
  }
}
resource operatorNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${prefix}-operator-nsg'
  location: location
  properties: {
    securityRules: [
      {
        name: 'ssh-from-bastion-only'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.86.4.0/26'
          sourcePortRange: '*'
          destinationAddressPrefix: '10.86.3.0/24'
          destinationPortRange: '22'
        }
      }
      {
        name: 'deny-other-inbound'
        properties: {
          priority: 200
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}
resource outboundIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${prefix}-operator-outbound'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}
resource nat 'Microsoft.Network/natGateways@2024-05-01' = {
  name: '${prefix}-operator-nat'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIpAddresses: [{ id: outboundIp.id }] }
}
resource operatorSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'operator'
  properties: {
    addressPrefix: '10.86.3.0/24'
    defaultOutboundAccess: false
    networkSecurityGroup: { id: operatorNsg.id }
    natGateway: { id: nat.id }
  }
}
resource bastionSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'AzureBastionSubnet'
  properties: { addressPrefix: '10.86.4.0/26' }
  dependsOn: [operatorSubnet]
}
resource bastionIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${prefix}-bastion-ip'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}
resource bastion 'Microsoft.Network/bastionHosts@2024-05-01' = {
  name: '${prefix}-bastion'
  location: location
  sku: { name: 'Basic' }
  properties: { ipConfigurations: [{
    name: 'private-operator'
    properties: { subnet: { id: bastionSubnet.id }, publicIPAddress: { id: bastionIp.id } }
  }] }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${prefix}-operator-nic'
  location: location
  properties: { ipConfigurations: [{ name: 'private', properties: {
    subnet: { id: operatorSubnet.id }
    privateIPAllocationMethod: 'Dynamic'
  } }] }
}
resource operator 'Microsoft.Compute/virtualMachines@2024-11-01' = {
  name: '${prefix}-operator'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${operatorIdentity.id}': {} } }
  properties: {
    hardwareProfile: { vmSize: 'Standard_D4as_v5' }
    storageProfile: {
      imageReference: { publisher: 'canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: ubuntuImageVersion }
      osDisk: { createOption: 'FromImage', diskSizeGB: 128, managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
    }
    osProfile: {
      computerName: '${prefix}-operator'
      adminUsername: operatorUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: { publicKeys: [{ path: '/home/${operatorUsername}/.ssh/authorized_keys', keyData: operatorSshPublicKey }] }
      }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
    securityProfile: { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } }
  }
}
output operatorVmId string = operator.id
output bastionId string = bastion.id
output operatorIdentityId string = operatorIdentity.id