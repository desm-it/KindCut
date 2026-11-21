#if defined(_WIN32)
// Windows SDK ABI probe only: no sockets, discovery, pairing or device I/O.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2bth.h>
#include <cstddef>
#include <cstdio>

static_assert(sizeof(SOCKADDR_BTH) == 30, "SOCKADDR_BTH packing differs from ctypes");
static_assert(offsetof(SOCKADDR_BTH, btAddr) == 2, "Unexpected BTH_ADDR offset");
static_assert(offsetof(SOCKADDR_BTH, serviceClassId) == 10, "Unexpected GUID offset");
static_assert(offsetof(SOCKADDR_BTH, port) == 26, "Unexpected channel offset");
static_assert(sizeof(GUID) == 16, "Unexpected GUID size");
static_assert(sizeof(SOCKET) == sizeof(void*), "SOCKET must be pointer-sized");
static_assert(sizeof(fd_set) == (sizeof(void*) == 8 ? 520 : 260), "Unexpected fd_set layout");
static_assert(offsetof(fd_set, fd_array) == (sizeof(void*) == 8 ? 8 : 4), "Unexpected fd_array alignment");
static_assert(sizeof(timeval) == 8, "Win32 LONG must remain 32-bit");
static_assert(sizeof(WSADATA) <= 512, "Opaque ctypes WSAStartup buffer is too small");
static_assert(offsetof(WSADATA, wVersion) == 0, "Unexpected WSA version offset");
static_assert(AF_BTH == 32 && BTHPROTO_RFCOMM == 3, "Unexpected Bluetooth constants");
static_assert(SOL_SOCKET == 0xffff && SO_ERROR == 0x1007, "Unexpected socket option constants");
static_assert(static_cast<unsigned long>(FIONBIO) == 0x8004667eUL, "Unexpected FIONBIO constant");

int main() {
    std::printf("{\"sockaddrBthBytes\":%zu,\"socketBytes\":%zu,\"fdSetBytes\":%zu,"
                "\"timevalBytes\":%zu,\"wsaDataBytes\":%zu,\"hardwareAccess\":false}\n",
                sizeof(SOCKADDR_BTH), sizeof(SOCKET), sizeof(fd_set),
                sizeof(timeval), sizeof(WSADATA));
    return 0;
}

#else
int main() {
    // Explicit unsupported-platform result, never a successful ABI check.
    return 77;
}
#endif
