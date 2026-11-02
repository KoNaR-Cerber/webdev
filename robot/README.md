# Cerber: telemetria i wbudowana kamera

Źródła i szablony konfiguracji z uruchomienia Lite3 na Jetsonie 2026-11-02.
To dokumentacja istniejącego wdrożenia, nie automatyczny instalator robota.
Adresy urządzeń, sieć VPN i dane dostępowe należy ustawić lokalnie.

- [telemetry](telemetry/README.md): odbiornik UDP, publikacja ROS 2 i ograniczony
  rosbridge do odczytu;
- [camera](camera/README.md): wbudowana kamera RTSP przesyłana do serwera mediów;
- [live-panel](../live-panel/README.md): lokalny podgląd publicznego API.

## Stan potwierdzony podczas uruchomienia

Na Jetsonie działały trzy usługi systemd z włączonym autostartem:

- `cerber-telemetry-receiver.service`;
- `cerber-telemetry-bridge.service`;
- `cerber-builtin-camera.service`.

Potwierdzono rzeczywiste IMU, 12 stawów, odometrię i odczyt ultradźwięków
w publicznym API oraz obraz wbudowanej kamery w przeglądarce (1280×720,
około 24 kl./s). Zera odometrii pochodziły z kontrolera; brakujące pola nie
były zastępowane danymi syntetycznymi. GPS i bateria nie były dostarczane
przez API. Jednostka ultradźwięków i fizyczna kalibracja osi wymagają
dalszego sprawdzenia.

Kontroler robota został ręcznie uruchomiony ponownie i telemetria wróciła.
Nie przeprowadzono jeszcze pełnego zimnego startu Jetsona. Przy zamykaniu
prac urządzenie nie było dostępne przez SSH; nie wykonano ponownego odczytu
końcowych plików z urządzenia. Szablony usług odzwierciedlają zapisane zmiany
wdrożenia i mają jawnie konfigurowalne parametry zamiast lokalnych adresów.

Oryginalny kontener ROS oraz pliki firmware pozostawiono bez zmian. Nowe
kontenery nie uruchamiają sterowników ruchu ani polityki sterowania.

## Sieć i adres odbiorcy telemetrii

Kontroler wysyła pakiety UDP do adresu wskazanego w swoim pliku
`/home/ysc/jy_exe/conf/network.toml`. Aktywne pole `ip` musi wskazywać adres
Ethernet Jetsona w sieci robota. Podczas tego wdrożenia zachowano porty:
`target_port = 43897` i `local_port = 43893`. Zmieniono wyłącznie aktywne
pole adresu odbiorcy; komentarze w pliku nie określają działającej konfiguracji.

Jetson otrzymał osobny profil Ethernet z adresem statycznym, autostartem
i wyłączonym przejmowaniem trasy domyślnej (`ipv4.never-default`).
Na tej instalacji NetworkManager zapisuje trwałe profile przez Netplan:
plik w `/etc/netplan/` jest źródłem, a profil w `/run/NetworkManager/`
jest plikiem wygenerowanym. Sam plik w `/run` nie dowodzi trwałości zapisu.
Hotspot, połączenie internetowe i VPN mają odrębne zadania i nie należy
zmieniać ich przy dostosowaniu interfejsu robota.

Nie ma tutaj skryptu automatycznie zmieniającego adresację lub konfigurację
kontrolera. Przed taką zmianą należy sprawdzić aktualne interfejsy, podsieci,
konflikty adresów i drogę powrotną SSH. Zmianę adresacji wykonywać z planem
wycofania, zachowując dostęp lokalny do urządzenia.

## Kopie i wycofanie zmian

Przed nadpisaniem istniejącego pliku utwórz jego kopię **na Jetsonie**
w katalogu pod `/var/backups/`, z zachowaniem właściciela i uprawnień.
Porównaj sumy SHA-256 kopii i oryginału przed edycją. Pliki zawierające
sekrety powinny pozostać dostępne wyłącznie dla roota.

Przy zmianie konfiguracji kontrolera zachowaj kopię zarówno na kontrolerze,
jak i na Jetsonie. Podczas uruchomienia 2026-11-02 wykonano takie kopie,
zachowano także oryginalny profil sieciowy i bazowy obraz Docker.
Kopie z urządzeń i pliki z credentialami nie należą do repozytorium.

Wycofuj tylko nowe usługi i profil dodane w ramach tego wdrożenia.
Nie usuwaj pierwotnego kontenera ROS ani istniejących profili sieciowych.
Przywrócenie adresu odbiorcy wymaga skoordynowania konfiguracji kontrolera
z adresem Ethernet Jetsona. Konfiguracja kontrolera została wczytana po
ręcznym restarcie robota wykonanym przez operatora w pozycji spoczynkowej.

## Następna weryfikacja na urządzeniu

1. Sprawdzić `systemctl is-enabled` i `systemctl is-active` dla trzech usług.
2. Po kontrolowanym zimnym starcie potwierdzić Ethernet, VPN, powrót kamery
   oraz świeże próbki wszystkich czterech źródeł telemetrii w panelu.
3. Sprawdzić źródło GPS i tor MQTT; samo połączenie brokera nie oznacza,
   że odbiornik GNSS publikuje lokalizację.
4. Zidentyfikować zasilacz, płytkę Jetsona i wyjście robota oraz zmierzyć
   napięcie i polaryzację przewodu przed zmianą sposobu zasilania.

Testy podglądu nie wymagają wydawania komend ruchu.
