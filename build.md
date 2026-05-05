# Tutorial Backend

## Build
in cerber_konar/webdev:
To build the backend, you need the following variables in .env file:
```env
EMQX_USERNAME=(default: admin)
EMQX_PASSWORD=(default: public)
```
Open ports:
 - UDP: 51820
 - TCP: 80, 443

Set SERVER_IP variable to your server IP address. (Or domain name if you have one)

Run selfcertification script to generate certificates for the backend: 
```bash
chmod +x selfcertfy.sh
./selfcertify.sh
```

Then, you can run the following command to build the backend:
```
docker compose up -d
```
Get Wireguard peer configuration:

./server/wg-config/peer_(peer name).conf

copy profile to your local machine and import it to your Wireguard client. You should be able to connect to the backend now.

