import socket
import sys

def check_port(host, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    result = sock.connect_ex((host, port))
    sock.close()
    if result == 0:
        print(f"Port {port} is OPEN")
        return True
    else:
        print(f"Port {port} is CLOSED (Error: {result})")
        return False

if __name__ == "__main__":
    check_port("localhost", 5432)
