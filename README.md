# Projekt-Cerber -- sekcja webdev
Readme pisało gemini żeby nie było
## Opis zadania
Zadaniem projektowym sekcji webdev jest stworzenie serwera HTTP do komunikacji z platformą robotyczną Cerber. 
Serwer ten ma za zadanie:
 - Odbierać dane telemetryczne z platformy Cerber i je wyświetlać w formie czytelnej dla użytkownika. 
 - Odbierać strumień wideo z kamery zamontowanej na platformie Cerber i wyświetlać go na stronie internetowej.
 - Umożliwiać użytkownikowi wysyłanie komend sterujących do platformy Cerber, na ten moment niezdefiniowanych.

## Architektura i Bezpieczeństwo
Cały system został zamknięty wewnątrz wirtualnej sieci prywatnej (VPN) z wykorzystaniem **WireGuard**, co zapewnia wysoki poziom bezpieczeństwa. 

Wszystkie kluczowe usługi (MediaMTX, EMQX, Nginx) współdzielą jeden stos sieciowy kontenera WireGuard (`network_mode: "service:wireguard"`). Dzięki temu aplikacje działają tak, jakby znajdowały się na jednym hoście lokalnym, a dostęp z zewnątrz jest możliwy tylko dla połączonych klientów VPN (adresy `10.13.13.x`).

## Technologie i Usługi
Do realizacji projektu wykorzystany jest Docker ze zdefiniowanymi następującymi serwisami:

1. **WireGuard (VPN Gateway)**
   - Pełni rolę bramy sieciowej dla całego systemu.
   - Nasłuchuje na porcie `51820/udp`.

2. **Nginx (Reverse Proxy & Serwer HTTP)**
   - Wymusza połączenie szyfrowane (przekierowanie z portu `80` na `443` HTTPS).
   - Serwuje frontendową aplikację UI z katalogu `/usr/share/nginx/html`.
   - Odpowiada za zaawansowany routing ścieżek do odpowiednich kontenerów podrzędnych wewnątrz sieci VPN (weryfikacja adresów IP z podsieci `10.13.13.0/24`).

3. **MediaMTX (Serwer Wideo WebRTC/SRT)**
   - Odbiera niskopoziomowy strumień wideo z platformy za pomocą protokołu **SRT** (port `8890`).
   - Udostępnia strumień w przeglądarce za pomocą **WebRTC** dla minimalnego opóźnienia. Konfiguracja wykorzystuje port `8889` do sygnalizacji oraz statyczny port `8189` (TCP) do przesyłu danych multimedialnych.
   - Skonfigurowana ścieżka dla głównej kamery to `jetson_stream`.

4. **Mosquitto (Broker MQTT - Telemetria)**
   - Zarządza odbiorem danych telemetrycznych.

## Dostępne Endpointy (Dla podłączonych do VPN)

Po podłączeniu się do sieci WireGuard, poszczególne interfejsy są dostępne pod adresem IP serwera (domyślnie `10.13.13.1`):

- **Główny interfejs (UI)**: `https://10.13.13.1/`


## Uruchomienie
Aby uruchomić całe środowisko, wykonaj:
```bash
docker-compose up -d
```
