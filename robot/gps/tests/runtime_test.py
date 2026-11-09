#!/usr/bin/env python3
"""Exercise the real runtime using private PTYs and an in-process MQTT broker.

Only robot_gps_test_devices is accepted: its compile-time test device policy
permits /dev/pts devices instead of production Quectel paths. No hardware or
external network endpoint is used.
"""
import errno
import json
import math
import os
import pty
import select
import signal
import socket
import subprocess
import sys
import threading
import time


def wait_for(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition did not become true before timeout")


def sentence(body):
    checksum = 0
    for byte in body.encode("ascii"):
        checksum ^= byte
    return f"${body}*{checksum:02X}\r\n".encode("ascii")


def sample(clock, valid=True):
    validity, quality = ("A", 1) if valid else ("V", 0)
    return sentence(
        f"GPRMC,{clock},{validity},4807.038,N,01131.000,E,0.0,0.0,031126,0.0,E,A"
    ) + sentence(
        f"GPGGA,{clock},4807.038,N,01131.000,E,{quality},08,0.9,545.4,M,46.9,M,,"
    )


class Broker:
    def __init__(self):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.listener.settimeout(0.1)
        self.port = self.listener.getsockname()[1]
        self.stopping = False
        self.paused = False
        self.connection = None
        self.connections = 0
        self.messages = []
        self.errors = []
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def exact(self, connection, size):
        data = bytearray()
        while len(data) < size and not self.stopping:
            try:
                chunk = connection.recv(size - len(data))
            except socket.timeout:
                continue
            if not chunk:
                raise EOFError
            data.extend(chunk)
        if len(data) != size:
            raise EOFError
        return bytes(data)

    def handle(self, connection):
        while not self.stopping:
            header = self.exact(connection, 1)[0]
            remaining, multiplier = 0, 1
            for _ in range(4):
                byte = self.exact(connection, 1)[0]
                remaining += (byte & 127) * multiplier
                if byte < 128:
                    break
                multiplier *= 128
            else:
                raise AssertionError("malformed MQTT remaining length")
            assert remaining <= 65536
            body = self.exact(connection, remaining)
            packet = header >> 4
            if packet == 1:  # CONNECT
                connection.sendall(b"\x20\x02\x00\x00")
                self.connections += 1
            elif packet == 3:  # PUBLISH
                length = int.from_bytes(body[:2], "big")
                topic = body[2:2 + length].decode()
                assert header & 0x0F == 0, "expected QoS 0, no retain and no DUP"
                self.messages.append((topic, json.loads(body[2 + length:])))
            elif packet == 12:  # PINGREQ
                connection.sendall(b"\xd0\x00")
            elif packet == 14:  # DISCONNECT
                return
            else:
                raise AssertionError(f"unexpected MQTT packet {packet}")

    def run(self):
        while not self.stopping:
            try:
                connection, address = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            assert address[0] == "127.0.0.1"
            if self.paused:
                connection.close()
                continue
            self.connection = connection
            connection.settimeout(0.1)
            try:
                self.handle(connection)
            except (EOFError, OSError):
                pass
            except Exception as error:
                self.errors.append(repr(error))
            finally:
                connection.close()
                self.connection = None

    def disconnect(self):
        self.paused = True
        if self.connection:
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def close(self):
        self.stopping = True
        self.disconnect()
        self.listener.close()
        self.thread.join(timeout=2)


class Modem:
    def __init__(self, fd):
        self.fd = fd
        self.stopping = False
        self.commands = []
        self.enabled = False
        self.errors = []
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        pending = b""
        while not self.stopping:
            if not select.select([self.fd], [], [], 0.1)[0]:
                continue
            try:
                chunk = os.read(self.fd, 1024)
            except OSError as error:
                if error.errno == errno.EIO:
                    continue
                self.errors.append(str(error))
                return
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                command = line.strip().decode("ascii")
                if not command:
                    continue
                self.commands.append(command)
                if command == "AT+QGPS?":
                    response = f"\r\n+QGPS: {int(self.enabled)}\r\n\r\nOK\r\n"
                elif command == "AT+QGPS=1":
                    self.enabled = True
                    response = "\r\nOK\r\n"
                else:
                    self.errors.append(f"unexpected AT command {command!r}")
                    response = "\r\nERROR\r\n"
                os.write(self.fd, response.encode("ascii"))

    def close(self):
        self.stopping = True
        self.thread.join(timeout=2)


def main():
    binary = os.path.abspath(sys.argv[1])
    assert os.path.basename(binary) == "robot_gps_test_devices"
    nmea_master, nmea_slave = pty.openpty()
    at_master, at_slave = pty.openpty()
    broker, modem = Broker(), Modem(at_master)

    def fixes():
        return [m for m in broker.messages if m[0] == "cerber/gps/data"]

    def statuses():
        return [m[1] for m in broker.messages if m[0] == "cerber/gps/status"]

    process = None
    output = []
    try:
        env = dict(os.environ, GPS_NMEA_DEVICE=os.ttyname(nmea_slave),
                   GPS_AT_DEVICE=os.ttyname(at_slave), GPS_MQTT_HOST="127.0.0.1",
                   GPS_MQTT_BIND_ADDRESS="127.0.0.1", GPS_MQTT_PORT=str(broker.port),
                   GPS_MQTT_TOPIC="cerber/gps/data", GPS_MQTT_STATUS_TOPIC="cerber/gps/status")
        process = subprocess.Popen([binary], env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True)
        reader = threading.Thread(target=lambda: output.extend(process.stdout), daemon=True)
        reader.start()
        wait_for(lambda: any("mqtt_connected awaiting_fresh_fix" in line for line in output))
        assert broker.connections == 1
        assert modem.commands == ["AT+QGPS?", "AT+QGPS=1", "AT+QGPS?"]
        wait_for(lambda: statuses())  # receiver status right after connecting, without any fix
        first = statuses()[0]
        assert set(first) == {"fix", "satellites", "nmea_alive", "published"}
        assert first["fix"] is False and first["satellites"] == 0 and first["published"] == 0
        assert all(topic == "cerber/gps/status" for topic, _ in broker.messages)

        os.write(nmea_master, sample("120000.00", valid=False))
        time.sleep(0.15)
        assert not fixes(), "no-fix input must never publish coordinates"

        payload = sample("120001.00")
        os.write(nmea_master, payload[:17])
        time.sleep(0.05)
        os.write(nmea_master, payload[17:])
        wait_for(lambda: len(fixes()) == 1)
        topic, fix = fixes()[0]
        assert topic == "cerber/gps/data"
        assert set(fix) == {"latitude", "longitude", "altitude", "satellites", "fix_quality", "date"}
        assert math.isclose(fix["latitude"], 48.1173, abs_tol=1e-8)
        assert math.isclose(fix["longitude"], 11.5166666667, abs_tol=1e-8)
        assert fix["altitude"] == 545.4
        assert fix["satellites"] == 8 and fix["fix_quality"] == 1
        assert fix["date"] == "2026-11-03T12:00:01Z"
        wait_for(lambda: any(s["published"] == 1 and s["satellites"] == 8 and s["nmea_alive"] for s in statuses()))

        os.write(nmea_master, sample("120002.00", valid=False))
        time.sleep(0.15)
        assert len(fixes()) == 1
        broker.disconnect()
        wait_for(lambda: any("mqtt_disconnected" in line for line in output))
        os.write(nmea_master, sample("120003.00"))
        time.sleep(0.15)
        broker.paused = False
        wait_for(lambda: sum("mqtt_connected awaiting_fresh_fix" in line for line in output) == 2)
        time.sleep(0.2)
        assert len(fixes()) == 1, "reconnection must not replay an offline fix"
        os.write(nmea_master, sample("120004.00"))
        wait_for(lambda: len(fixes()) == 2)
        assert fixes()[1][1]["date"] == "2026-11-03T12:00:04Z"

        process.send_signal(signal.SIGTERM)
        assert process.wait(timeout=3) == 0
        reader.join(timeout=2)
        assert not broker.errors, broker.errors
        assert not modem.errors, modem.errors
        print("runtime PTY/MQTT: receiver status, no-fix, canonical fix, reconnect without replay, SIGTERM passed")
    except BaseException:
        print("".join(output), file=sys.stderr)
        raise
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        broker.close()
        modem.close()
        for fd in (nmea_master, nmea_slave, at_master, at_slave):
            os.close(fd)


if __name__ == "__main__":
    main()
