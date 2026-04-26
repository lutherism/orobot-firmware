# Station ESP firmware

Fake-phone client used by the orobot HW integration test rig.

## Serial protocol (115200 8N1, JSON lines)

Inbound (host → station):

    {"cmd":"run-portal","ssid":"...","pass":"...","code":"123456","portalIp":"192.168.4.1"}

Outbound (station → host):

    {"event":"boot","version":"..."}
    {"event":"portal-result","ok":true,"observed":[{"step":"join","ms":1240}, ...]}
    {"event":"portal-result","ok":false,"error":"join-failed","detail":"..."}

## Build & flash

    cd orobot-firmware/esp32-station
    py -m platformio run -e station            # build
    py -m platformio run -e station -t upload  # flash (host writes to USB)
