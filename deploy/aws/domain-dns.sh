#!/bin/bash
# DNS for Buildiary in Amazon Route 53. Run once in AWS CloudShell:
#   bash domain-dns.sh buildiary.app buildiaryapp.com
# For each domain: a hosted zone (about $0.50 a month), with the domain and every name under it
# (*.domain: customers' workspaces, my., www.) pointing at the server's fixed address.
# Then, at the registrar (Namecheap), set each domain's nameservers to the four printed here.
set -euo pipefail
export AWS_DEFAULT_REGION="${REGION:-ap-south-1}"
IP=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="${SERVER_NAME:-mimaar-server}" --query 'Addresses[0].PublicIp' --output text)
[ -n "$IP" ] && [ "$IP" != "None" ] || { echo "No fixed address found for the server"; exit 1; }
for D in "$@"; do
  Z=$(aws route53 list-hosted-zones-by-name --dns-name "$D." --query "HostedZones[?Name=='$D.'].Id | [0]" --output text)
  if [ -z "$Z" ] || [ "$Z" = "None" ]; then
    Z=$(aws route53 create-hosted-zone --name "$D" --caller-reference "buildiary-$D-$(date +%s)" \
      --hosted-zone-config Comment="Buildiary",PrivateZone=false --query HostedZone.Id --output text)
  fi
  Z=${Z#/hostedzone/}
  aws route53 change-resource-record-sets --hosted-zone-id "$Z" --change-batch "{\"Comment\":\"Buildiary server\",\"Changes\":[
    {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$D\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$IP\"}]}},
    {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"*.$D\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$IP\"}]}}]}" >/dev/null
  echo "== $D and *.$D -> $IP (zone $Z). Nameservers to set at the registrar:"
  aws route53 get-hosted-zone --id "$Z" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n'
done
