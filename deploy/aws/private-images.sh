#!/bin/bash
# Private images for Mabni in this AWS account (Amazon ECR), so the GitHub repository can be private.
# Run once in AWS CloudShell (safe to run again):   bash private-images.sh
#
#  - two private image stores: "mabni" (the server: ERPNext + Mabni + the website files) and
#    "mabni-office" (the old Mimaar web app); only the last 10 images of each are kept;
#  - GitHub signs in to AWS without any stored password (OpenID Connect). Two roles, each usable only
#    by one branch of one repository and only able to upload to its own image store:
#      mabni-github-server  <- smazharhasan/site-office, branch erpnext-app  -> mabni
#      mabni-github-office  <- smazharhasan/site-office, branch main         -> mabni-office
#  - the server (role mimaar-server) may only download from the two stores.
set -euo pipefail
REGION="${REGION:-ap-south-1}"; export AWS_DEFAULT_REGION="$REGION"
GH_REPO="${GH_REPO:-smazharhasan/site-office}"
SERVER_ROLE="${SERVER_ROLE:-mimaar-server}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REG="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
say() { printf '\n== %s\n' "$*"; }

say "Image stores"
for r in mabni mabni-office; do
  if ! aws ecr describe-repositories --repository-names "$r" >/dev/null 2>&1; then
    aws ecr create-repository --repository-name "$r" --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 --image-tag-mutability MUTABLE >/dev/null
    echo "created $REG/$r"
  else
    echo "exists  $REG/$r"
  fi
  aws ecr put-lifecycle-policy --repository-name "$r" --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep the last 10 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}' >/dev/null
done

say "GitHub's sign-in to AWS"
OIDC="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd >/dev/null
  echo "created"
else
  echo "exists"
fi

role() {  # name branch store
  local name="$1" branch="$2" store="$3"
  local trust="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Federated\":\"$OIDC\"},
    \"Action\":\"sts:AssumeRoleWithWebIdentity\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\",
    \"token.actions.githubusercontent.com:sub\":\"repo:$GH_REPO:ref:refs/heads/$branch\"}}}]}"
  if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$name" --policy-document "$trust"
  else
    aws iam create-role --role-name "$name" --max-session-duration 3600 --description "GitHub $GH_REPO ($branch) uploads images to $store" \
      --assume-role-policy-document "$trust" >/dev/null
  fi
  aws iam put-role-policy --role-name "$name" --policy-name upload-images --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:InitiateLayerUpload\",\"ecr:UploadLayerPart\",\"ecr:CompleteLayerUpload\",
      \"ecr:PutImage\",\"ecr:BatchGetImage\",\"ecr:GetDownloadUrlForLayer\",\"ecr:DescribeImages\"],
     \"Resource\":\"arn:aws:ecr:$REGION:$ACCOUNT:repository/$store\"}]}"
  echo "$name: arn:aws:iam::$ACCOUNT:role/$name"
}
say "Upload roles"
role mabni-github-server erpnext-app mabni
role mabni-github-office main mabni-office

say "The server may download"
aws iam put-role-policy --role-name "$SERVER_ROLE" --policy-name download-images --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
  {\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},
  {\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:BatchGetImage\",\"ecr:GetDownloadUrlForLayer\",\"ecr:DescribeImages\"],
   \"Resource\":[\"arn:aws:ecr:$REGION:$ACCOUNT:repository/mabni\",\"arn:aws:ecr:$REGION:$ACCOUNT:repository/mabni-office\"]}]}"
echo "$SERVER_ROLE: download only"

say "PRIVATE IMAGES READY: $REG/mabni and $REG/mabni-office"
