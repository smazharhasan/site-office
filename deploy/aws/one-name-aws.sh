#!/bin/bash
# One time only: the AWS side of the move to the single name Buildiary. In AWS CloudShell, from a copy of
# this folder:
#   bash one-name-aws.sh            new image store, roles, backup bucket (backups copied), server tags;
#                                   the server is given its new role and security group
#   bash one-name-aws.sh --cleanup  after the server's switch (one-name.sh): removes the old roles,
#                                   image stores, passwords and security group
# The old backup bucket is left for the owner to delete in the S3 console once the copies are checked.
# Delete this file once done.
set -euo pipefail
REGION="${REGION:-ap-south-1}"; export AWS_DEFAULT_REGION="$REGION"
HERE="$(cd "$(dirname "$0")" && pwd)"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
OLD=mimaar-server; NEW=buildiary-server
OLD_BUCKET="mimaar-backups-$ACCOUNT-$REGION"; BUCKET="buildiary-backups-$ACCOUNT-$REGION"
say() { printf '\n== %s\n' "$*"; }
instance() { aws ec2 describe-instances --filters "Name=tag:Name,Values=$OLD,$NEW" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text; }
ID=$(instance); [ -n "$ID" ] && [ "$ID" != "None" ] || { echo "No server found"; exit 1; }

if [ "${1:-}" != "--cleanup" ]; then
  say "The server's role: $NEW"
  if ! aws iam get-role --role-name "$NEW" >/dev/null 2>&1; then
    aws iam create-role --role-name "$NEW" --description "Buildiary server" --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    aws iam attach-role-policy --role-name "$NEW" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  fi
  aws iam put-role-policy --role-name "$NEW" --policy-name buildiary-backups-and-password --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[
     {\"Effect\":\"Allow\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::buildiary-backups-$ACCOUNT-*\",\"arn:aws:s3:::buildiary-backups-$ACCOUNT-*/*\"]},
     {\"Effect\":\"Allow\",\"Action\":[\"ssm:PutParameter\",\"ssm:GetParameter\"],\"Resource\":[\"arn:aws:ssm:*:$ACCOUNT:parameter/buildiary/*\"]}]}"
  if ! aws iam get-instance-profile --instance-profile-name "$NEW" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$NEW" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$NEW" --role-name "$NEW"
    sleep 12   # a new instance profile takes a few seconds to be usable
  fi

  say "Image store and GitHub's role"
  SERVER_ROLE="$NEW" bash "$HERE/private-images.sh"

  say "Backup bucket: $BUCKET"
  if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":60}}]}'
  fi
  if aws s3api head-bucket --bucket "$OLD_BUCKET" 2>/dev/null; then
    aws s3 sync "s3://$OLD_BUCKET" "s3://$BUCKET" --only-show-errors
    echo "backups copied: $(aws s3 ls "s3://$BUCKET" --recursive --summarize | awk '/Total Objects/{print $3}') files"
  fi

  say "The server: $ID"
  ASSOC=$(aws ec2 describe-iam-instance-profile-associations --filters Name=instance-id,Values="$ID" --query 'IamInstanceProfileAssociations[0].AssociationId' --output text)
  CUR=$(aws ec2 describe-iam-instance-profile-associations --filters Name=instance-id,Values="$ID" --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text)
  if [[ "$CUR" != *"/$NEW" ]]; then
    for i in 1 2 3 4 5; do
      aws ec2 replace-iam-instance-profile-association --association-id "$ASSOC" --iam-instance-profile Name="$NEW" >/dev/null && break
      sleep 10
    done
  fi
  echo "role: $NEW"
  VPC=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].VpcId' --output text)
  SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=buildiary-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
  if [ -z "$SG" ] || [ "$SG" = "None" ]; then
    SG=$(aws ec2 create-security-group --group-name buildiary-web --description "Buildiary: web only (80, 443)" --vpc-id "$VPC" --query GroupId --output text)
    aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
      'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' >/dev/null
    aws ec2 create-tags --resources "$SG" --tags Key=Name,Value=buildiary-web
  fi
  aws ec2 modify-instance-attribute --instance-id "$ID" --groups "$SG"
  echo "security group: buildiary-web"
  VOLS=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].BlockDeviceMappings[].Ebs.VolumeId' --output text)
  ALLOC=$(aws ec2 describe-addresses --filters Name=instance-id,Values="$ID" --query 'Addresses[0].AllocationId' --output text)
  aws ec2 create-tags --resources "$ID" $VOLS $ALLOC --tags Key=Name,Value="$NEW"
  echo "tags: $NEW"
  [ -f ~/run.sh ] && sed -i "s/$OLD/$NEW/g; s/Mimaar server/Buildiary server/" ~/run.sh || true
  say "AWS READY: run one-name.sh on the server next"
else
  say "Removing the old roles"
  if aws iam get-instance-profile --instance-profile-name "$OLD" >/dev/null 2>&1; then
    aws iam remove-role-from-instance-profile --instance-profile-name "$OLD" --role-name "$OLD" 2>/dev/null || true
    aws iam delete-instance-profile --instance-profile-name "$OLD"
  fi
  for r in "$OLD" mabni-github-server mabni-github-office; do
    aws iam get-role --role-name "$r" >/dev/null 2>&1 || continue
    for p in $(aws iam list-role-policies --role-name "$r" --query 'PolicyNames' --output text); do aws iam delete-role-policy --role-name "$r" --policy-name "$p"; done
    for a in $(aws iam list-attached-role-policies --role-name "$r" --query 'AttachedPolicies[].PolicyArn' --output text); do aws iam detach-role-policy --role-name "$r" --policy-arn "$a"; done
    aws iam delete-role --role-name "$r" && echo "removed role $r"
  done
  say "Removing the old image stores (build output only; the server runs the buildiary image)"
  for s in mabni mabni-office; do aws ecr delete-repository --repository-name "$s" --force >/dev/null 2>&1 && echo "removed $s" || true; done
  say "Removing the old password entries (copied under /buildiary/)"
  for p in /mimaar/administrator-password /mabni/wordpress-admin-password; do aws ssm delete-parameter --name "$p" 2>/dev/null && echo "removed $p" || true; done
  say "Removing the old security group"
  VPC=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].VpcId' --output text)
  OSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=mimaar-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
  [ -n "$OSG" ] && [ "$OSG" != "None" ] && aws ec2 delete-security-group --group-id "$OSG" && echo "removed mimaar-web" || true
  say "CLEANED UP. Left for you: the old backup bucket $OLD_BUCKET (its backups are copied to $BUCKET); delete it in the S3 console when you are happy."
fi
