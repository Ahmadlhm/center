FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/Center/Center.csproj server/Center/
RUN dotnet restore server/Center/Center.csproj
COPY server/Center server/Center
RUN dotnet publish server/Center/Center.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
USER root
RUN install -d -m 0700 -o "$APP_UID" -g "$APP_UID" /var/lib/center-keys
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources && apt-get -o Acquire::Retries=4 -o Acquire::By-Hash=force update && apt-get install -y --no-install-recommends ca-certificates fonts-noto-core tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet","Center.dll"]

FROM runtime AS ocr
USER root
RUN apt-get -o Acquire::Retries=4 -o Acquire::By-Hash=force update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng poppler-utils && rm -rf /var/lib/apt/lists/*
USER $APP_UID

FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY web/package*.json .
RUN npm ci
COPY web .
COPY logo.png /logo.png
RUN npm run build

FROM nginx:alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /src/dist /usr/share/nginx/html
