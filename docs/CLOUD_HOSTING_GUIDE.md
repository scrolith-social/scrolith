# Scrolith Cloud Hosting Guide (Azure, AWS, GCP)

This guide explains how to:

1. Prepare the project for production
2. Push from your computer to GitHub
3. Deploy from local machine or GitHub to Microsoft Azure, AWS, and Google Cloud

It is written for this repository layout:

- `geezle/` -> frontend (Vite React)
- `geezle-backend/` -> backend (Node.js + Prisma)
- `docker-compose.prod.yml` -> local production simulation
- `deploy/docker/` -> production Dockerfiles

Backend runtime note:
- The reviewed Azure backend image builds TypeScript into `dist/` and starts with `node dist/server.js`; it does not use the development `ts-node` command.

---

## 1) Prerequisites

Install these tools on your machine:

- Git
- Docker Desktop (or Docker Engine)
- Node.js 20+
- One cloud CLI of your choice:
  - Azure CLI (`az`)
  - AWS CLI (`aws`)
  - Google Cloud CLI (`gcloud`)

Accounts/services needed:

- GitHub repository: `https://github.com/scrolith-social/scrolith`
- Managed PostgreSQL (recommended) or a secure self-managed Postgres
- Domain + TLS certificate (production)

---

## 2) Download/Transfer the project

### Option A: Download from GitHub

```bash
git clone --recurse-submodules git@github.com:geezlesocial/scrolith.git
cd scrolith
git submodule sync --recursive
git submodule update --init --recursive
```

### Option B: Transfer from your current computer

1. Copy the project folder to the target machine
2. Open terminal in the copied folder
3. Ensure Git remotes are valid:

```bash
git remote -v
git submodule sync --recursive
git submodule update --init --recursive
```

---

## 3) Production configuration

1. Copy env template:

```bash
cp .env.production.example .env.production
```

2. Update at minimum:

- `JWT_SECRET`
- `DATABASE_URL`
- `FRONTEND_URL`
- `BACKEND_URL`
- payment/storage/email keys used in your environment

3. Run local production simulation:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up --build
```

Smoke checks:

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:5000/api/health`

---

## 4) Push changes to GitHub

If you are working locally, push in this order:

1. Commit frontend submodule changes
2. Commit parent repository changes (including updated submodule pointer)

Example:

```bash
# inside submodule
cd geezle
git add .
git commit -m "feat: frontend updates"
git push origin <your-branch>

# back to parent repo
cd ..
git add .
git commit -m "chore: backend/deploy updates + bump geezle submodule"
git push origin <your-branch>
```

Then open a Pull Request to `main`.

---

## 5) Microsoft Azure deployment

The old Azure sample commands in this guide have been retired: they used `eastus`, mutable `latest` tags, secret-bearing CLI arguments, and the wrong frontend container port. Follow the pinned-source, Southeast Asia runbook instead: [Azure Container Apps release guide](AZURE_CONTAINER_APPS_RELEASE_GUIDE.md). It is a review and deployment-planning document, not authorization to create resources or deploy.

---

## 6) AWS deployment

Recommended: AWS App Runner + Amazon RDS (PostgreSQL).

### 6.1 Create and push to ECR

```bash
aws configure
aws ecr create-repository --repository-name scrolith-backend
aws ecr create-repository --repository-name scrolith-frontend
```

Authenticate Docker to ECR:

```bash
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
```

Build/push:

```bash
docker build -f deploy/docker/backend.Dockerfile -t <account-id>.dkr.ecr.<region>.amazonaws.com/scrolith-backend:latest .
docker build -f deploy/docker/frontend.Dockerfile -t <account-id>.dkr.ecr.<region>.amazonaws.com/scrolith-frontend:latest .

docker push <account-id>.dkr.ecr.<region>.amazonaws.com/scrolith-backend:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/scrolith-frontend:latest
```

### 6.2 Deploy with App Runner

Create two services in App Runner:

- `scrolith-backend` from backend ECR image (port 5000)
- `scrolith-frontend` from frontend ECR image (port 80)

Set backend environment variables:

- `NODE_ENV=production`
- `PORT=5000`
- `DATABASE_URL=<RDS postgres URL>`
- `JWT_SECRET=<secret>`
- `FRONTEND_URL=<frontend app URL>`

### 6.3 Finalize

- Use Amazon RDS PostgreSQL with private networking
- Restrict security groups
- Add CloudWatch logs/alarms
- Attach custom domain + ACM certificate

---

## 7) Google Cloud deployment

Recommended: Cloud Run + Cloud SQL (PostgreSQL).

### 7.1 Enable APIs and auth

```bash
gcloud auth login
gcloud config set project <project-id>
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com
```

### 7.2 Build and push images (Artifact Registry)

```bash
gcloud artifacts repositories create scrolith --repository-format=docker --location=us-central1
gcloud auth configure-docker us-central1-docker.pkg.dev

docker build -f deploy/docker/backend.Dockerfile -t us-central1-docker.pkg.dev/<project-id>/scrolith/backend:latest .
docker build -f deploy/docker/frontend.Dockerfile -t us-central1-docker.pkg.dev/<project-id>/scrolith/frontend:latest .

docker push us-central1-docker.pkg.dev/<project-id>/scrolith/backend:latest
docker push us-central1-docker.pkg.dev/<project-id>/scrolith/frontend:latest
```

### 7.3 Deploy Cloud Run services

```bash
gcloud run deploy scrolith-backend \
  --image us-central1-docker.pkg.dev/<project-id>/scrolith/backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 5000 \
  --set-env-vars NODE_ENV=production,PORT=5000,DATABASE_URL="<cloud-sql-url>",JWT_SECRET="<secret>",FRONTEND_URL="https://<frontend-domain>"
```

```bash
gcloud run deploy scrolith-frontend \
  --image us-central1-docker.pkg.dev/<project-id>/scrolith/frontend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 80
```

### 7.4 Finalize

- Configure Cloud SQL private IP + IAM/service account access
- Map custom domains
- Add Cloud Logging/Monitoring alerts

---

## 8) Production hardening checklist

- Use strong secrets in a secret manager (Azure Key Vault / AWS Secrets Manager / GCP Secret Manager)
- Enforce HTTPS only
- Restrict CORS to known frontend domains
- Run Prisma migrations before/with release
- Enable DB backups and point-in-time recovery
- Configure uptime checks and alerting
- Configure autoscaling min/max instances
- Set log retention and central error tracking

---

## 9) Recommended release flow

1. Develop on feature branch
2. Run builds locally
3. Push branch to GitHub
4. Open PR and merge to `main`
5. Build/push images
6. Deploy backend, then frontend
7. Run smoke tests:
   - login
   - create post
   - upload file
   - core dashboards load

---

## 10) Quick troubleshooting

- Frontend shows blank page:
  - check browser console
  - verify `VITE_API_URL` and `VITE_BACKEND_URL` at image build time
- Backend cannot connect DB:
  - verify `DATABASE_URL`
  - verify network/security rules
- 401 for authenticated endpoints:
  - verify `JWT_SECRET` consistency across running backend instances
- CORS errors:
  - verify `FRONTEND_URL` and allowed origin settings in backend env
