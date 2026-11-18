import {readFile} from 'node:fs/promises';
const i=JSON.parse(await readFile(new URL('../deploy/azure/cost-model-20261118.json',import.meta.url),'utf8'));
const h=i.hours,s=h*3600,r=i.rates,p=i.provisionalRates;
const app=(cpu,gib)=>s*(cpu*r.acaCpuSecond+gib*r.acaGiBSecond);
const common={api:app(.5,1),frontend:app(.25,.5),scanner:app(1.5,3),privateAcr:r.acrPremiumDay*h/24,privateEndpoints:5*p.privateEndpointHour*h,operatorVm:r.vmD4asHour*h,operatorDisk:15,bastion:r.bastionBasicHour*h,nat:p.natHour*h,publicIps:2*p.publicIpHour*h,dnsAndVault:8};
const scenarios={
  syntheticStaging:{...common,redis:h*r.redisB3NodeHour,postgres:h*r.postgresB1msHour,databaseStorageAndBackup:15,blobAndQueue:5,logs:20,mediaJobsAndDispatch:10,networkUsage:15,alerts:5},
  recommendedProduction:{...common,redis:h*r.redisM10NodeHour*2,postgres:h*r.postgresD2dsHour*2,databaseStorageAndBackup:50,blobAndQueue:20,logs:80,mediaJobsAndDispatch:40,networkUsage:80,alerts:15},
  growthProposal:{...common,api:app(2,4),scanner:app(1.5,3)*2,redis:h*r.redisB10NodeHour*2,postgres:h*r.postgresD2dsHour*4,databaseStorageAndBackup:120,blobAndQueue:60,logs:400,mediaJobsAndDispatch:300,networkUsage:150,alerts:30,edgeAndDisasterRecoveryAllowance:500}
};
const rows=Object.fromEntries(Object.entries(scenarios).map(([name,items])=>{const subtotal=Object.values(items).reduce((a,b)=>a+b,0);return[name,{items,subtotal,contingency:subtotal*i.contingency,total:subtotal*(1+i.contingency)}];}));
rows.simultaneousSeparateStagingAndProduction={total:rows.syntheticStaging.total+rows.recommendedProduction.total,requiresSecondEnvironmentQuota:true,sharesNoDataPlane:true};
rows.availabilityFocusedProduction={total:(rows.recommendedProduction.subtotal+common.scanner+300)*(1+i.contingency),extra:'second scanner plus $300/month separate restore/DR/edge allowance; scope and account quote not approved'};
console.log(JSON.stringify({inputs:i,scenarios:rows,decision:'NOT A QUOTE; all Redis capacities and billable provisioning remain blocked pending review.'},null,2));
