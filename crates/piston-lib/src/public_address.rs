//! Public artifact destinations. Conservative special-use policy based on IANA's
//! IPv4/IPv6 special-purpose registries (reviewed 2026-11-08).
//! No hostname, credential, proxy or trusted-LAN exceptions belong here.
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, d] = v.octets();
            !matches!(a, 0 | 10 | 127)
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 169 && b == 254)
                && !(a == 172 && (16..=31).contains(&b))
                && !(a == 192 && b == 168)
                && !(a == 192 && b == 0 && c == 0 && !matches!(d, 9 | 10))
                && !(a == 192 && b == 0 && c == 2)
                && !(a == 192 && b == 88 && c == 99)
                && !(a == 198 && (18..=19).contains(&b))
                && !(a == 198 && b == 51 && c == 100)
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(v) => {
            let octets = v.octets();
            let segments = v.segments();
            // Evaluate embedded IPv4, never treat mapped/NAT64 private IPv4 as public.
            if v.to_ipv4_mapped().is_some() {
                return false;
            }
            if segments[0] == 0x64 && segments[1] == 0xff9b && segments[2..6] == [0, 0, 0, 0] {
                return is_public_ip(IpAddr::V4(Ipv4Addr::new(
                    octets[12], octets[13], octets[14], octets[15],
                )));
            }
            if segments[0] & 0xe000 != 0x2000 {
                return false;
            }
            if segments[0] == 0x2001 && segments[1] < 0x200 {
                return matches!(
                    v.to_bits(),
                    0x20010001000000000000000000000001..=0x20010001000000000000000000000003
                ) || segments[1] == 3
                    || (segments[1] == 4 && segments[2] == 0x112)
                    || segments[1] & 0xfff0 == 0x20
                    || segments[1] & 0xfff0 == 0x30;
            }
            !(segments[0] == 0x2001 && segments[1] == 0xdb8)
                && segments[0] != 0x2002
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}

pub fn is_public_socket(address: SocketAddr) -> bool {
    is_public_ip(address.ip())
        && match address {
            SocketAddr::V6(v) => v.scope_id() == 0,
            _ => true,
        }
}

pub fn public_answers(addresses: &[SocketAddr]) -> bool {
    !addresses.is_empty() && addresses.iter().all(|a| is_public_socket(*a))
}

pub fn peer_matches(selected: SocketAddr, actual: SocketAddr) -> bool {
    is_public_socket(selected)
        && is_public_socket(actual)
        && selected.port() == actual.port()
        && selected.ip().to_canonical() == actual.ip().to_canonical()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_and_special_ranges_include_embedded_ipv4() {
        for text in [
            "8.8.8.8",
            "1.1.1.1",
            "192.0.0.9",
            "192.0.0.10",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
            "64:ff9b::808:808",
        ] {
            assert!(is_public_ip(text.parse().unwrap()), "public {text}");
        }
        for text in [
            "0.0.0.0",
            "0.1.2.3",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.0.8",
            "192.0.0.170",
            "192.0.2.1",
            "192.88.99.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::127.0.0.1",
            "::ffff:127.0.0.1",
            "::ffff:8.8.8.8",
            "64:ff9b::a00:1",
            "64:ff9b:1::1",
            "100::1",
            "2001::1",
            "2001:2::1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "3fff::1",
            "5f00::1",
            "fc00::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
        ] {
            assert!(!is_public_ip(text.parse().unwrap()), "special {text}");
        }
    }
    #[test]
    fn mixed_answers_and_wrong_peer_fail_closed() {
        let public = "8.8.8.8:443".parse().unwrap();
        let private = "127.0.0.1:443".parse().unwrap();
        assert!(public_answers(&[public]));
        assert!(!public_answers(&[]));
        assert!(!public_answers(&[public, private]));
        assert!(peer_matches(public, public));
        assert!(!peer_matches(public, private));
        assert!(!peer_matches(public, "1.1.1.1:443".parse().unwrap()));
        assert!(!peer_matches(public, "8.8.8.8:8443".parse().unwrap()));
    }
}
