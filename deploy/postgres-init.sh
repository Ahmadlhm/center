#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v identity_pw="$IDENTITY_PASSWORD" -v people_pw="$PEOPLE_PASSWORD" \
  -v education_pw="$EDUCATION_PASSWORD" -v work_pw="$WORK_PASSWORD" \
  -v documents_pw="$DOCUMENTS_PASSWORD" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE center_identity LOGIN PASSWORD :'identity_pw';
CREATE ROLE center_people LOGIN PASSWORD :'people_pw';
CREATE ROLE center_education LOGIN PASSWORD :'education_pw';
CREATE ROLE center_work LOGIN PASSWORD :'work_pw';
CREATE ROLE center_documents LOGIN PASSWORD :'documents_pw';
CREATE SCHEMA identity AUTHORIZATION center_identity;
CREATE SCHEMA people AUTHORIZATION center_people;
CREATE SCHEMA education AUTHORIZATION center_education;
CREATE SCHEMA work AUTHORIZATION center_work;
CREATE SCHEMA documents AUTHORIZATION center_documents;
SQL
