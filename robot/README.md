# Cerber: telemetria, wbudowana kamera i GPS

Źródła i szablony konfiguracji z uruchomienia Lite3 na Jetsonie 2026-11-02–03.
To dokumentacja istniejącego wdrożenia, nie automatyczny instalator robota.
Adresy urządzeń, sieć VPN i dane dostępowe należy ustawić lokalnie.

- [telemetry](telemetry/README.md): odbiornik UDP, publikacja ROS 2 i ograniczony
  rosbridge do odczytu;
- [camera](camera/README.md): wbudowana kamera RTSP przesyłana do serwera mediów;
- [gps](gps/README.md): Quectel GNSS, publikator C i przesyłanie pozycji przez MQTT;
- [wifi-locator](wifi-locator/README.md): zastępcza pozycja z sieci Wi‑Fi (Google
  Geolocation API), gdy odbiornik GNSS nie ma fixu;
- [live-panel](../live-panel/README.md): lokalny podgląd publicznego API.

## Stan potwierdzony podczas uruchomienia 2026-11-02

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

## Uzupełnienie 2026-11-03: źródło GPS i publikator

Źródłem GPS jest moduł USB Quectel EG25, a nie telemetria kontrolera Lite3
ani wbudowany odbiornik Jetsona. Repo firmware zawierało źródła C
`Interp4GPSComm`, ale brakowało uruchomionego publikatora. Jego dotychczasowe
nazwy pól JSON i adres brokera wymagały dostosowania do obecnego API.

Wdrożono osobny, przetestowany `robot_gps` w `/opt/cerber-gps/` i usługę
`cerber-gps.service` z autostartem. Konfiguracja jest w `/etc/cerber/gps.env`,
dostępna tylko dla roota. Oryginalny firmware zachowano, a jego źródła GPS
i konfigurację skopiowano i zweryfikowano na Jetsonie przed wdrożeniem.

Potwierdzono odbiór NMEA, połączenie MQTT przez VPN i poprawny restart samej
usługi GPS. Parser, obsługa portu szeregowego i pełna ścieżka publikacji
przeszły trzy zestawy testów na Jetsonie; testy używały wyłącznie prywatnych
pseudoterminali i lokalnego brokera. Nowa usługa czyta interfejs NMEA IF01
i korzysta z wolnego dodatkowego portu AT IF03; nie zajmuje IF02 używanego
przez ModemManager.

Podczas sprawdzania antena pozostawała w pomieszczeniu: moduł zgłaszał
`no_fix` i 0 używanych satelitów. Nie wysłano współrzędnych, a API nadal
nie miało pozycji GPS. Rzeczywisty fix, dobór anteny i cała ścieżka pozycji
do API wymagają potwierdzenia przy dostępie anteny do otwartego nieba.
Publikator wysyła wyłącznie kompletną świeżą pozycję z datą UTC.

Po ponownym uruchomieniu Jetsona i przywróceniu kabla Ethernet trzy usługi
kamery i telemetrii ponownie działały; po wdrożeniu GPS pozostały aktywne,
a API raportowało działające połączenia rosbridge i MQTT. Nie wykonano
pełnego zimnego startu z nowo dodanym publikatorem GPS.

## Uzupełnienie 2026-11-03: zastępcza pozycja z Wi‑Fi

W pomieszczeniu odbiornik GNSS nie ma fixu, a API nie ma pozycji. Dodano
`robot/wifi-locator`: usługa `cerber-wifi-locator.service` skanuje sieci Wi‑Fi
przez `nmcli`, pyta Google Geolocation API i publikuje szacunek na ten sam temat
MQTT co publikator GNSS, w formacie `GPSFix` z `source: "wifi"` i promieniem
błędu `accuracy_m`. Gateway pomija takie próbki, dopóki ma fix GNSS młodszy niż
60 s, więc prawdziwy odbiornik zawsze wygrywa. Konfiguracja (klucz API, broker)
jest w `/etc/cerber/wifi-locator.env`, tylko dla roota. Instalacja i sprawdzenie
ścieżki opisane są w README usługi; wdrożenie na urządzeniu wymaga dostępu do
Jetsona i klucza Google Cloud ograniczonego do Geolocation API.

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

1. Po kolejnym starcie sprawdzić `systemctl is-enabled` i `systemctl is-active`
   dla pięciu usług, w tym `cerber-gps` i `cerber-wifi-locator`.
2. Po kontrolowanym zimnym starcie potwierdzić Ethernet, VPN, powrót kamery
   oraz świeże próbki wszystkich czterech źródeł telemetrii w panelu.
3. Przy antenie na zewnątrz potwierdzić rzeczywisty fix i świeże `gps_at`
   w API; samo połączenie brokera nie oznacza poprawnej lokalizacji.
4. Zidentyfikować zasilacz, płytkę Jetsona i wyjście robota oraz zmierzyć
   napięcie i polaryzację przewodu przed zmianą sposobu zasilania.

Testy podglądu nie wymagają wydawania komend ruchu.
