@echo off
echo === Git commit and push ===
cd /d C:\Users\benez\grocery-agent
git add .
set /p msg="Commit message: "
git commit -m "%msg%"
git push

echo === Building Docker image ===
docker build -t europe-west1-docker.pkg.dev/project-ba84fdc4-ae52-4acd-b99/salvador/api:latest C:\Users\benez\grocery-agent

echo === Pushing to Artifact Registry ===
docker push europe-west1-docker.pkg.dev/project-ba84fdc4-ae52-4acd-b99/salvador/api:latest

echo === Deploying to Cloud Run ===
gcloud run deploy salvador-api --image europe-west1-docker.pkg.dev/project-ba84fdc4-ae52-4acd-b99/salvador/api:latest --region europe-west1 --project project-ba84fdc4-ae52-4acd-b99

echo === Done! ===
pause
