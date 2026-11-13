The launcher copy is now the intended single source. The server should later depend on this copy rather than maintaining a fork.

Discovery is enabled by the launcher client. The normal tests vendor their PAKE fixture. The nested tests/conformance harness is a server-checkout harness retained from the source copy; it is not a launcher workspace member.
