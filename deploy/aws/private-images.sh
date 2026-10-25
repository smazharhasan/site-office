#!/bin/bash
# The private image store for Buildiary in this AWS account (Amazon ECR), so the GitHub repository can be private.
# Run once in AWS CloudShell (safe to run again):   bash private-images.sh
#
#  - one private image store, "buildiary" (the server: ERPNext + Buildiary + the website files);
#    only the last 10 images are kept;
#  - GitHub signs in to AWS without any stored password (OpenID Connect). The role buildiary-github can
#    be used only by the erpnext-app branch of one repository and may only upload to that store. The
#    repository is named by its owner's and its own fixed GitHub ids, so renaming it changes nothing
#    and a different repository given the same name later cannot use the role;
#  - the server (role buildiary-server) may only download.
set -euo pipefail
REGION="${REGION:-ap-south-1}"; export AWS_DEFAULT_REGION="$REGION"
GH_OWNER_ID="${GH_OWNER_ID:-6824215}"      # smazharhasan
GH_REPO_ID="${GH_REPO_ID:-1425456645}"     # smazharhasan/buildiary
BRANCH="${BRANCH:-erpnext-app}"
STORE=buildiary
ROLE=buildiary-github
SERVER_ROLE="${SERVER_ROLE:-buildiary-server}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REG="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
say() { printf '\n== %s\n' "$*"; }

say "Image store"
if ! aws ecr describe-repositories --repository-names "$STORE" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "$STORE" --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 --image-tag-mutability MUTABLE >/dev/null
  echo "created $REG/$STORE"
else
  echo "exists  $REG/$STORE"
fi
aws ecr put-lifecycle-policy --repository-name "$STORE" --lifecycle-policy-text \
  '{"rules":[{"rulePriority":1,"description":"keep the last 10 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}' >/dev/null

say "GitHub's sign-in to AWS"
OIDC="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd >/dev/null
  echo "created"
else
  echo "exists"
fi

say "Upload role"
TRUST="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Federated\":\"$OIDC\"},
  \"Action\":\"sts:AssumeRoleWithWebIdentity\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\"},
  \"StringLike\":{\"token.actions.githubusercontent.com:sub\":\"repo:*@$GH_OWNER_ID/*@$GH_REPO_ID:ref:refs/heads/$BRANCH\"}}}]}"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$ROLE" --max-session-duration 3600 --description "GitHub (Buildiary, $BRANCH) uploads images to $STORE" \
    --assume-role-policy-document "$TRUST" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name upload-images --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
  {\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},
  {\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:InitiateLayerUpload\",\"ecr:UploadLayerPart\",\"ecr:CompleteLayerUpload\",
    \"ecr:PutImage\",\"ecr:BatchGetImage\",\"ecr:GetDownloadUrlForLayer\",\"ecr:DescribeImages\"],
   \"Resource\":\"arn:aws:ecr:$REGION:$ACCOUNT:repository/$STORE\"}]}"
echo "$ROLE: arn:aws:iam::$ACCOUNT:role/$ROLE"

if aws iam get-role --role-name "$SERVER_ROLE" >/dev/null 2>&1; then
  say "The server may download"
  aws iam put-role-policy --role-name "$SERVER_ROLE" --policy-name download-images --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:BatchGetImage\",\"ecr:GetDownloadUrlForLayer\",\"ecr:DescribeImages\"],
     \"Resource\":\"arn:aws:ecr:$REGION:$ACCOUNT:repository/$STORE\"}]}"
  echo "$SERVER_ROLE: download only"
fi

say "PRIVATE IMAGES READY: $REG/$STORE"
