#!/bin/bash
mkdir -p server/certs
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout server/certs/nginx-selfsigned.key \
  -out server/certs/nginx-selfsigned.crt \
