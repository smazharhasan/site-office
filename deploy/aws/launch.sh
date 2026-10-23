#!/bin/bash
# Creates the Mimaar ERP server in an AWS account. Run in AWS CloudShell:
#   bash launch.sh            (Mumbai by default; REGION=... to change; TYPE=... for the server size)
# Needs mimaar-data.json.gz.b64 (the project data from the old Mimaar app) in the same folder.
# Safe to run again: it reuses what already exists.
set -euo pipefail
REGION="${REGION:-ap-south-1}"; export AWS_DEFAULT_REGION="$REGION"
TYPE="${TYPE:-m7i-flex.large}"
NAME=mimaar-server
REF="${REF:-erpnext-app}"
say() { printf '\n== %s\n' "$*"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
say "Account $ACCOUNT, region $REGION, server type $TYPE"
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A \
  --query 'Quota.Value' --output text 2>/dev/null | xargs -I{} echo "On-demand vCPU limit: {}" || true

# ---- the server's permissions: Session Manager (admin access without SSH keys), its backup bucket, its password
if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  say "Creating the server role"
  aws iam create-role --role-name "$NAME" --description "Mimaar ERP server" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
fi
aws iam put-role-policy --role-name "$NAME" --policy-name mimaar-backups-and-password --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[
   {\"Effect\":\"Allow\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::mimaar-backups-$ACCOUNT-*\",\"arn:aws:s3:::mimaar-backups-$ACCOUNT-*/*\"]},
   {\"Effect\":\"Allow\",\"Action\":[\"ssm:PutParameter\",\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:*:$ACCOUNT:parameter/mimaar/*\"}]}"
if ! aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  echo "Waiting for the role to be ready..."; sleep 15
fi

# ---- firewall: only the web (http for the certificate, https for everything else)
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=mimaar-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  say "Creating the firewall"
  SG=$(aws ec2 create-security-group --group-name mimaar-web --description "Mimaar: web only (80, 443)" --vpc-id "$VPC" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' >/dev/null
fi

# ---- a fixed public address (Elastic IP), so the web address never changes
ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC" = "None" ]; then
  ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
fi
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
DOMAIN="mimaar.${IP//./-}.sslip.io"
say "Address: https://$DOMAIN"

# ---- the server
ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$ID" = "None" ]; then
  [ -s mimaar-data.json.gz.b64 ] || { echo "mimaar-data.json.gz.b64 is missing"; exit 1; }
  AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
  {
    echo '#!/bin/bash'
    echo "cat > /root/mimaar-data.json.gz.b64 <<'DATA'"
    cat mimaar-data.json.gz.b64
    echo 'DATA'
    echo 'base64 -d /root/mimaar-data.json.gz.b64 | gunzip > /root/mimaar-data.json && rm -f /root/mimaar-data.json.gz.b64'
    echo "curl -fsSL https://raw.githubusercontent.com/smazharhasan/site-office/$REF/deploy/aws/bootstrap.sh -o /root/mimaar-bootstrap.sh"
    echo "MIMAAR_DOMAIN=$DOMAIN MIMAAR_DATA_FILE=/root/mimaar-data.json bash /root/mimaar-bootstrap.sh"
  } > user-data.sh
  say "Starting the server ($TYPE, Ubuntu 24.04, 40 GB disk)"
  ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" \
    --iam-instance-profile Name="$NAME" --security-group-ids "$SG" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":40,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
    --user-data file://user-data.sh \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
  rm -f user-data.sh
fi
echo "Server: $ID"
aws ec2 wait instance-running --instance-ids "$ID"
aws ec2 associate-address --allocation-id "$ALLOC" --instance-id "$ID" --allow-reassociation >/dev/null
aws ec2 modify-instance-attribute --instance-id "$ID" --disable-api-termination
say "Server running at $IP. Mimaar ERP is being set up (10-15 minutes): https://$DOMAIN"
