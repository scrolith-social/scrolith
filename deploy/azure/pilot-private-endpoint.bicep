param name string
param location string
param connectionId string
param group string
param zone string
param vnetId string
param subnetId string

resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: zone
  location: 'global'
}

resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: name
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: name
  location: location
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: name
        properties: {
          privateLinkServiceId: connectionId
          groupIds: [group]
        }
      }
    ]
  }
}

resource association 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: group
        properties: { privateDnsZoneId: dns.id }
      }
    ]
  }
  dependsOn: [link]
}
