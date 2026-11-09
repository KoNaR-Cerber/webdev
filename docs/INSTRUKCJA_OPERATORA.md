# Cerber — panel na żywo. Instrukcja dla operatora

Ta instrukcja jest dla osoby, która obsługuje panel podczas testów i pokazów:
ogląda obraz i dane z robota, nagrywa przebieg sesji i ustawia nagranie jako demo.
Nie trzeba znać się na technice. Wszystko robi się w przeglądarce.

Panel **tylko pokazuje** dane. Nie ma w nim żadnego przycisku, który steruje robotem.
Robotem steruje osobna aplikacja (dashboard teleoperacji), dostępna tylko przez VPN.

## 1. Wejście do panelu

1. Otwórz w przeglądarce adres: **https://cerber.machinekind.ai/**
2. Przeglądarka zapyta o login i hasło. Dostajesz je od administratora
   (nie przesyłaj ich dalej, nie zapisuj w publicznych miejscach).
3. Po zalogowaniu panel sam łączy się z robotem. Nic więcej nie trzeba klikać.

Działa w aktualnym Chrome, Firefoksie, Safari i Edge, na komputerze i telefonie.
Mapa wymaga dostępu przeglądarki do internetu (pobiera podkład z OpenStreetMap).
Bez internetu reszta panelu działa, tylko mapa się nie pokaże.

Jeśli coś przestało się odświeżać, kliknij **Połącz ponownie** w prawym górnym rogu.
To pierwsza rzecz do zrobienia przy każdym problemie. Odświeżenie strony (F5) też pomaga.

## 2. Co widać na ekranie

### Pasek u góry

W prawym górnym rogu jest wskaźnik połączenia:

| Napis | Znaczenie |
|---|---|
| **Telemetria na żywo** (zielony) | Wszystko działa. Robot jest włączony i wysyła dane. |
| **Robot offline** (pomarańczowy) | Panel ma połączenie z serwerem, ale robot nic nie wysyła od ponad 5 sekund. Zwykle robot jest wyłączony albo nie ma sieci. |
| **Łączenie z telemetrią** | Panel jeszcze nie połączył się z serwerem. Chwilę po otwarciu strony to normalne. Jeśli trwa długo, kliknij **Połącz ponownie**. |

Na samym dole strony są dwa małe napisy: **ROS** i **MQTT**. To dwa kanały, którymi
dane płyną z robota. Przy normalnej pracy oba pokazują „połączony”.
Jeśli ROS jest „rozłączony”, przestają się odświeżać orientacja, stawy, odometria
i ultradźwięki. Jeśli MQTT jest „rozłączony”, przestaje się odświeżać GPS.

### Karty z danymi

Każda karta ma w prawym górnym rogu **wiek danych**. To najważniejsza rzecz do sprawdzania:

| Napis | Znaczenie |
|---|---|
| **Teraz** albo **1.5 s temu** | Dane są świeże. |
| **Nieaktualne · 12 s** (karta przygaszona) | Dane są starsze niż 5 sekund. Robot przestał je wysyłać. Liczby na karcie to ostatnia znana wartość, nie stan bieżący. |
| **Brak danych** | Ten rodzaj danych jeszcze nie dotarł od uruchomienia serwera. |

Kreska (—) w miejscu liczby zawsze oznacza brak wartości. Panel nigdy nie wstawia
wartości zastępczych ani nie zmyśla danych.

**Kamera wbudowana.** Obraz z przedniej kamery robota. Pod obrazem jest zegar
(czas lokalny Twojego komputera), a gdy obraz leci, także rozdzielczość i liczba
klatek na sekundę, np. „1280 × 720 · 25 kl./s”. Napisy w rogu karty:

- „Łączenie…” — trwa nawiązywanie połączenia z kamerą,
- „● Na żywo” — połączenie z serwerem wideo działa,
- „Oczekiwanie na obraz…” na czarnym tle — połączenie jest, ale kamera robota nie nadaje,
- „Obraz chwilowo niedostępny” albo „Kamera: HTTP …” — połączenie padło, panel sam
  spróbuje ponownie za kilka sekund.

Obraz z kamery i dane telemetryczne idą osobnymi drogami. Może działać jedno bez drugiego.

**Orientacja korpusu.** Sztuczny horyzont jak w samolocie i trzy kąty w stopniach:

- **Roll** — przechył na boki (lewa/prawa),
- **Pitch** — pochylenie przód/tył,
- **Yaw** — obrót wokół osi pionowej (kierunek, w którym robot „patrzy”).

Robot stojący równo na płaskim podłożu ma roll i pitch bliskie zeru.

**Ultradźwięki.** Surowy odczyt czujnika odległości. Skala nie jest potwierdzona,
dlatego panel nie dopisuje jednostki. Służy do porównań („zmienia się / nie zmienia się”).

**Odometria.** Prędkość robota do przodu (m/s) i jego pozycja XYZ w metrach względem
punktu, w którym robot zaczął liczyć. Zero to prawidłowy odczyt dla stojącego robota.

**GPS.** Pozycja robota. Duży napis mówi, skąd pochodzi:

- **Fix · 8 sat.** — pozycja z odbiornika satelitarnego, widzi 8 satelitów. Dokładne.
- **Wi‑Fi ±40 m** — robot nie widzi satelitów (np. w budynku), pozycja jest
  oszacowana z pobliskich sieci Wi‑Fi. Liczba po ± to promień niepewności w metrach.
- **Telefon ±8 m** — pozycja z telefonu operatora stojącego przy robocie (patrz
  „Pozycja z telefonu” niżej). Liczba po ± to dokładność podana przez telefon.
- **Bez fixu · 3 sat.** — odbiornik działa, ale widzi za mało satelitów. Czeka. Na dworze
  z czystym niebem fix pojawia się zwykle w ciągu kilku minut od włączenia robota.
- **Brak danych** — pozycja ani stan odbiornika nie dotarły.

Mały napis pod spodem to współrzędne, a gdy ich nie ma, stan odbiornika:
„Odbiornik działa · czeka na satelity” jest normalne; „Odbiornik: brak kontaktu od 45 s”
oznacza, że moduł GPS na robocie przestał się odzywać.

**Bateria.** Obecnie robot nie wysyła stanu baterii, więc karta pokazuje „Brak danych”.
To nie jest usterka panelu.

**Mapa.** Pojawia się dopiero, gdy jest jakakolwiek pozycja. Kropka to robot, kółko
wokół niej to promień niepewności (duże przy pozycji z Wi‑Fi, znika przy GPS).
Mapa sama podąża za robotem. Gdy ją przesuniesz ręcznie, przestaje podążać;
**Wyśrodkuj** włącza podążanie z powrotem. **OpenStreetMap** otwiera to miejsce
w nowej karcie, co jest wygodne, gdy chcesz wysłać komuś link z pozycją.

**Wykresy: Orientacja, Przyspieszenie, Prędkość kątowa.** Ostatnie 60 sekund.
Przyspieszenie z nieruchomego robota może pokazywać około 9.8 m/s² na jednej osi
(grawitacja); to nie jest błąd. Wykresy są do obserwowania, czy coś się dzieje, a nie do odczytywania
dokładnych wartości.

**Nogi robota.** 12 stawów, po trzy na nogę. LF/RF to przednie nogi (lewa/prawa),
LB/RB to tylne. Każdy staw ma kąt w stopniach i kropkę na skali od −180° do +180°.
Gdy robot chodzi, kropki się ruszają. Gdy stoi, są nieruchome.

**Nagrania.** Opisane osobno poniżej. Jeśli tej karty nie ma, nagrywanie nie jest
włączone na tym serwerze. Zgłoś to administratorowi.

### Jak często odświeżają się dane

Serwer przesyła najwyżej jedną aktualizację na sekundę z każdego źródła. Obraz z kamery
jest niezależny i płynny. Nie oczekuj, że liczby będą zmieniać się szybciej niż raz na sekundę.

## 3. Nagrywanie sesji

Nagranie zawiera **obraz z kamery wbudowanej** i **wszystkie dane telemetryczne**
(orientacja, stawy, odometria, GPS itd.) z tego samego czasu. Nagrywa serwer, nie Twoja
przeglądarka. Możesz zamknąć kartę, a nagranie będzie trwało aż do limitu
(patrz niżej). Nagranie widzą i mogą zatrzymać wszyscy, którzy mają otwarty panel.

### Przed nagraniem

- Sprawdź, że u góry jest **Telemetria na żywo**. Przy „Łączenie z telemetrią” przycisk
  **Rejestruj** jest szary. Przy „Robot offline” da się nagrywać, ale do nagrania nie
  trafi nic nowego, bo robot nic nie wysyła.
- Sprawdź, że kamera pokazuje obraz. Bez obrazu nagranie zapisze samą telemetrię.
  Nagrywanie tego nie przerwie, ale pliku wideo nie będzie.
- Przeczytaj małą linijkę obok przycisku. Pokazuje aktualne limity, na przykład:
  „Limit 10:00 lub 600 MB na nagranie · 30 nagrań / 6144 MB łącznie”.

### Start i stop

1. Kliknij **● Rejestruj**.
2. Napis w rogu karty zmieni się na **NAGRYWANIE · 0:12 / 10:00** (czas, który minął,
   i limit). Obok przycisku pokazuje się rozmiar, liczba zapisanych zdarzeń telemetrii
   i ewentualnie „bez obrazu (kamera nie nadaje)”.
3. Kliknij **■ Zatrzymaj**, gdy skończysz.
4. W tabeli pod przyciskiem nagranie ma w trakcie długość „trwa”. Kilka sekund po
   zatrzymaniu wiersz dostaje długość, rozmiar i powód zakończenia.

Nagranie zatrzyma się samo, gdy:

- minie limit czasu (domyślnie 10 minut),
- rozmiar przekroczy limit (domyślnie 600 MB),
- serwer panelu zostanie zrestartowany (wtedy nagranie jest ucięte, ale zapisane).

Jeśli potrzebujesz dłuższej sesji, nagrywaj w kilku kawałkach: zatrzymaj i od razu
uruchom ponownie. Nagrania w tabeli są w kolejności od najnowszego.

### Pozycja z telefonu

Gdy odbiornik GPS robota nie działa (np. uszkodzony moduł albo odpięta antena), pozycję
może dostarczyć telefon operatora, który stoi przy robocie. Działa to tak:

1. Otwórz panel w przeglądarce **na telefonie** (nie na laptopie: pozycja laptopa to nie
   pozycja robota).
2. Kliknij **● Rejestruj**. Panel sam zacznie wysyłać pozycję telefonu; przeglądarka
   zapyta o zgodę na lokalizację, zgódź się. Jeśli nie nagrywasz, to samo włącza przycisk
   **Pozycja z tego telefonu** w karcie GPS.
3. W karcie GPS pod przyciskiem widać „Wysyłam ±8 m · 25 poz.”. Na mapie pozycja ma
   napis „Pozycja z telefonu operatora”, a w karcie GPS „Telefon ±8 m”.
4. Karta panelu musi być na wierzchu, a ekran włączony. Gdy przeglądarka pójdzie w tło
   albo telefon stoi w miejscu, nowe pomiary przestają przychodzić. Panel wtedy co 10 s
   wysyła ponownie ostatnią znaną pozycję (z czasem tamtego pomiaru), żeby nagranie
   miało ciągły ślad, i pokazuje „ostatni pomiar 40 s temu, podtrzymuję pozycję”.
   Panel prosi system o niewygaszanie ekranu, ale nie każdy telefon to respektuje,
   więc na czas nagrania wyłącz w telefonie automatyczną blokadę ekranu.
5. **■ Nie wysyłaj pozycji telefonu** wyłącza wysyłanie; zatrzymanie nagrania go nie
   wyłącza.

Pozycja z telefonu trafia wszędzie tam, gdzie pozycja z odbiornika: do nagrania,
do API partnerów (`source: phone`) i do bazy. Jeśli odbiornik robota znowu złapie fix,
ma pierwszeństwo przez minutę po każdym swoim odczycie.

### Tabela nagrań

| Kolumna | Co pokazuje |
|---|---|
| **Nagranie (UTC)** | Data i godzina startu w czasie UTC (w Polsce zimą UTC jest o 1 godzinę wcześniejsze niż czas lokalny, latem o 2). To zarazem nazwa nagrania. |
| **Długość** | Czas trwania (minuty:sekundy). |
| **Rozmiar** | Wideo i telemetria razem. „bez wideo” oznacza, że kamera nie nadawała. |
| **Zakończone** | Jak nagranie się skończyło: „ręcznie”, „limit czasu”, „limit rozmiaru”, „restart panelu”. |

Przy każdym zakończonym nagraniu: linki **Wideo ↓** i **Telemetria ↓** (pobieranie plików),
przycisk **Do demo** / **Usuń z demo** (playlista demo, patrz rozdział 4) i **Usuń**.
Usunięcie pyta o potwierdzenie i jest nieodwracalne.

### Ile nagrań się mieści

Serwer trzyma ograniczoną liczbę nagrań (domyślnie 30) i ograniczony łączny rozmiar
(domyślnie 6 GB). Po każdym zatrzymaniu **najstarsze nagrania są kasowane automatycznie**,
gdy limit jest przekroczony. Nagrania z playlisty demo nigdy nie są kasowane automatycznie.

Wniosek: jeśli jakieś nagranie jest ważne, **pobierz je zaraz po sesji** albo dołóż do demo,
żeby nie zniknęło w rotacji.

### Jak dostać pliki nagrania

W tabeli przy zakończonym nagraniu są linki **Wideo ↓** i **Telemetria ↓**. Kliknięcie
pobiera plik na komputer (w telefonie do folderu pobranych). Nazwa pliku zaczyna się od
nazwy nagrania, np. `2026-11-03T10-05-07Z-video.mp4`. Wideo może mieć kilkaset MB, więc
na telefonie lepiej pobierać po Wi‑Fi.

- `video.mp4` — obraz z kamery, otwiera się w każdym odtwarzaczu (VLC, QuickTime, Windows);
  nagranie bez obrazu nie ma tego linku,
- `telemetry.ndjson` — dane telemetryczne, jedna linia tekstu na każde zdarzenie,
  do analizy przez osobę techniczną,
- `meta.json` (czas startu i końca, długość, rozmiary, powód zakończenia) ma adres
  `/recordings/<nazwa>/meta.json`, bez linku w tabeli.

## 4. Demo: pokaz bez robota

Demo to jedno nagranie albo playlista do 5 nagrań, odtwarzane **po kolei w pętli** jako
udawany robot (obraz i telemetria razem). Służy do pokazów, gdy
prawdziwy robot jest wyłączony, i do testów dla partnerów, którzy podłączają się do API.
Demo działa cały czas, niezależnie od robota.

Co dostają odbiorcy demo:

- obraz z nagrania pod adresem **https://cerber.machinekind.ai/video/normal_cam/demo/**
  (wymaga klucza API, tak jak reszta API; w przeglądarce bez klucza działa tylko z VPN),
- dane telemetryczne z nagrania jako robot o nazwie `cerber-demo` w API
  (to interesuje tylko osoby techniczne po stronie partnera).

Gdy playlista demo jest pusta, demo pokazuje kolorowe pasy testowe
(albo plik przygotowany przez administratora). Panel na żywo pod głównym adresem
zawsze pokazuje prawdziwego robota, nigdy demo.

### Ustawianie demo

1. W tabeli nagrań kliknij **Do demo** przy pierwszym nagraniu, potem przy kolejnych
   w takiej kolejności, w jakiej mają lecieć. Każde dostaje znacznik **DEMO 1**, **DEMO 2**…,
   a pod przyciskiem nagrywania widać całą playlistę w kolejności.
2. Najwyżej 5 nagrań; przy pełnej playliście przycisk **Do demo** jest wyłączony.
   **Usuń z demo** wyjmuje jedno nagranie (reszta zachowuje kolejność), **Wyczyść demo**
   opróżnia playlistę. Żeby zmienić kolejność, wyczyść i dodaj od nowa.
3. Demo przełącza się w kilka sekund, bez restartów. Osoby oglądające demo
   zobaczą krótką przerwę w obrazie. Po ostatnim nagraniu playlista zaczyna się od
   pierwszego; między nagraniami jest sekunda przerwy w telemetrii.
4. Nagranie bez obrazu daje w demo tylko telemetrię; obraz w tym czasie leci z
   następnego nagrania z wideo (obraz i telemetria nie są ze sobą ściśle zsynchronizowane).

Tylko jedno nagranie na raz może być demo. Kliknięcie przy innym nagraniu
przełącza wybór. **Wyłącz demo** wraca do pasów testowych.

Dobre nagranie na demo: robot w ruchu, obraz z kamery włączony, od 1 do 5 minut.
Nagranie demo widzi każdy partner z kluczem API. Nie ustawiaj jako demo nagrania, które
pokazuje miejsce, osoby albo pozycję, których nie chcemy udostępniać na zewnątrz.
Nagranie „bez wideo” jako demo da tylko telemetrię, obraz wróci do pasów testowych.

Nagrania demo nie da się usunąć (przycisk **Usuń** jest szary). Najpierw **Wyłącz demo**.

## 5. Lista kontrolna przed pokazem

1. Zaloguj się do panelu i kliknij **Połącz ponownie**.
2. U góry ma być **Telemetria na żywo**, a na dole „ROS: połączony” i „MQTT: połączony”.
3. Kamera ma pokazywać obraz, a zegar pod nią ma chodzić.
4. Karty **Orientacja korpusu** i **Nogi robota** mają pokazywać „Teraz” albo „x s temu”.
5. Na dworze: poczekaj, aż GPS pokaże **Fix**. W budynku spodziewaj się **Wi‑Fi ±…**.
6. Jeśli pokaz ma być nagrany: sprawdź wolne miejsce w linijce limitów i zrób
   krótkie nagranie próbne (10 sekund), zatrzymaj, sprawdź, że w tabeli nie ma „bez wideo”.
7. Jeśli pokaz ma iść z demo: upewnij się, że właściwe nagranie ma znacznik **DEMO**.
   Z VPN możesz otworzyć adres demo w drugiej karcie, żeby zobaczyć, co widzą odbiorcy.

## 6. Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Przeglądarka nie pyta o hasło albo nie wpuszcza | Sprawdź adres (https://cerber.machinekind.ai/). Poproś administratora o aktualny login i hasło. |
| **Łączenie z telemetrią** przez ponad minutę | Kliknij **Połącz ponownie**, potem odśwież stronę. Jeśli nie pomaga, problem jest po stronie serwera: zgłoś administratorowi. |
| **Robot offline** | Robot jest wyłączony, nie ma sieci albo nie uruchomiono na nim usług telemetrii. Panel sam wróci do „na żywo”, gdy robot zacznie nadawać. Sprawdź robota, nie panel. |
| „ROS: rozłączony” przy „MQTT: połączony” | Robot ma sieć, ale nie działa na nim program wysyłający dane z czujników. Zgłoś osobie od robota. |
| Obraz z kamery się nie pojawia, dane działają | Kamera robota nie nadaje. Kliknij **Połącz ponownie**. Jeśli nadal „Oczekiwanie na obraz…”, kamera po stronie robota jest wyłączona. |
| Obraz „zamarzł” | Kliknij **Połącz ponownie**. |
| Karta przygaszona, „Nieaktualne · N s” | Robot przestał wysyłać ten rodzaj danych. Liczby są ostatnią znaną wartością. |
| GPS: **Brak fixu** na dworze | Poczekaj kilka minut. Odbiornik potrzebuje otwartego nieba. Między wysokimi budynkami i pod dachem fixu może nie być. |
| GPS: „Odbiornik: brak kontaktu od N s” | Moduł GPS na robocie przestał nadawać. Zgłoś osobie od robota. |
| Mapa się nie pokazuje mimo pozycji | Przeglądarka nie ma dostępu do internetu albo blokuje OpenStreetMap. Pozycja w karcie GPS jest nadal prawdziwa. |
| Przycisk **Rejestruj** jest szary | U góry jest „Łączenie z telemetrią”: panel nie ma połączenia z serwerem. Kliknij **Połącz ponownie**. |
| W rogu karty Nagrania jest „Błąd: …” | Zapisz treść komunikatu i spróbuj jeszcze raz. „Camera recorder unavailable” oznacza problem z serwerem wideo: zgłoś administratorowi. |
| Nagranie „bez wideo” | W czasie nagrania kamera nie nadawała. Następnym razem sprawdź obraz przed kliknięciem **Rejestruj**. |
| Nagranie zniknęło z tabeli | Zostało skasowane przez rotację (za dużo nagrań albo za duży łączny rozmiar). Ważne nagrania kopiuj zaraz po sesji albo ustaw jako demo. |
| Nagranie zakończone „restart panelu” | Serwer został zrestartowany w trakcie. Nagranie jest zapisane do momentu restartu. |
| Nie da się kliknąć **Usuń** | To nagranie jest demo. Najpierw **Wyłącz demo**. |

Zgłaszając problem, podaj: co pokazuje wskaźnik u góry, napisy ROS/MQTT na dole,
godzinę i, jeśli dotyczy nagrania, jego nazwę z tabeli.

## 7. Słowniczek

- **Telemetria** — dane z czujników robota przesyłane na bieżąco (bez obrazu).
- **IMU** — czujnik ruchu w korpusie: mierzy orientację, przyspieszenie i obrót.
- **Roll / pitch / yaw** — przechył na boki / pochylenie przód‑tył / obrót w poziomie.
- **Odometria** — przebyta droga i prędkość liczone przez robota z ruchu nóg.
- **GNSS / GPS** — odbiornik satelitarny. **Fix** to ustalona pozycja; **satelity** to liczba
  satelitów, które odbiornik widzi (im więcej, tym lepiej; 4 to minimum).
- **ROS, MQTT** — dwa kanały, którymi dane płyną z robota do serwera. Oba mają być „połączony”.
- **UTC** — czas uniwersalny, w którym nazwane są nagrania. Polska: UTC+1 zimą, UTC+2 latem.
- **Demo** — nagranie odtwarzane w pętli jako udawany robot, dostępne dla partnerów z kluczem API.
- **Rotacja** — automatyczne kasowanie najstarszych nagrań, gdy jest ich za dużo.
- **NDJSON** — format pliku z telemetrią w nagraniu: jedna linia tekstu na jedno zdarzenie.
