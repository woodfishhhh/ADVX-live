from __future__ import annotations

import json

from advx_backend.api.ws.realtime import _negotiate_protocol_version
from advx_backend.contracts.realtime import (
    SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
    ClientHello,
)


def negotiate_with_supported(hello: ClientHello, supported: tuple[int, ...]) -> int | None:
    offered = hello.supported_protocol_versions or [hello.protocol_version]
    common = set(offered).intersection(supported)
    return max(common) if common else None


def main() -> None:
    current_client = ClientHello(
        protocol_version=4,
        token="synthetic-local-token",
        supported_protocol_versions=[4, 3],
    )
    older_client = ClientHello(
        protocol_version=3,
        token="synthetic-local-token",
    )
    result = {
        "current_server_supported": list(SUPPORTED_REALTIME_PROTOCOL_VERSIONS),
        "current_client_current_server": _negotiate_protocol_version(current_client),
        "older_client_current_server": _negotiate_protocol_version(older_client),
        "current_client_older_v3_oracle": negotiate_with_supported(current_client, (3,)),
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
