set -e -o pipefail
ps -ax | grep 'switch-to' | awk '{print $1}' | xargs kill || true
ps -ax | grep 'retry-ap.sh' | awk '{print $1}' | xargs kill || true
ps -ax | grep 'retry-client.sh' | awk '{print $1}' | xargs kill || true
ps -ax | grep 'dhclient' | awk '{print $1}' | xargs kill || true
