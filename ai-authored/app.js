/*
Load known networks.
Try connecting (use WpaCtrl events for 'CONNECTED'/'DISCONNECTED').
Set up interval (e.g., every 5min) to check internet (ping google.com), retry/fallback if down.
On disconnect: Retry 3x with backoff, then cycle networks, then AP.
Use mdns Node.js lib to browse for _orobot._tcp.local.
On discovery: Fetch /api/networks from peer's IP, merge new networks (avoid duplicates by SSID), save, and attempt connect if better.
Trigger sharing periodically or on connect (e.g., broadcast to discovered peers).
Retries: Use WpaCtrl's built-in retries; add app-level loop for multiple networks.
Fallback: If no internet after 3 full cycles, switchToAP() and notify via UI/LED.
Multi-Device Sync: Prioritize networks with higher signal/recent success; share only on same LAN (mDNS scope).
Security/Privacy: Require a one-time PIN for sharing; encrypt passwords in transit (HTTPS).
Testing: Simulate failures by disabling WiFi; ensure seamless mode switches.
*/
