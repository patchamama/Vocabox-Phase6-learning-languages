import unittest
from unittest.mock import Mock, patch

from app.services import leo_service


VALID_HTML = """<script><xml leorendertarget="true"><section sctTitle="noun"><entry aiid="1"><side lang="de"><repr>Fortschritt</repr></side><side lang="es"><repr>progreso</repr></side></entry></section></xml></script>"""


class LeoProxyFailoverTests(unittest.TestCase):
    def setUp(self):
        # These tests exercise tier 1 (curl_cffi) only — keep the fast-tier
        # circuit breaker (DB-backed) out of the picture and never let a
        # real Playwright browser launch if tier 1 is exhausted.
        patcher_down = patch.object(leo_service, "get_leo_fast_tier_down_until", return_value=None)
        patcher_mark = patch.object(leo_service, "_mark_fast_tier_down")
        patcher_clear = patch.object(leo_service, "_clear_fast_tier_down")
        self.addCleanup(patcher_down.stop)
        self.addCleanup(patcher_mark.stop)
        self.addCleanup(patcher_clear.stop)
        patcher_down.start()
        patcher_mark.start()
        patcher_clear.start()

    def test_lookup_uses_saved_proxy_first_then_fails_over_on_unusable_response(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.text = VALID_HTML

        with (
            patch.object(leo_service, "get_leo_last_working_proxy", return_value="http://last"),
            patch.object(leo_service, "get_youtube_proxy_url", return_value="http://bad,http://good"),
            patch.object(leo_service, "is_sticky_supported", return_value=True),
            patch.object(leo_service, "set_leo_last_working_proxy") as save_proxy,
            patch.object(
                leo_service,
                "_fetch_html",
                # _fetch_html's real contract: raise on a blocked candidate
                # (network error or Cloudflare challenge), never return one.
                side_effect=[RuntimeError("Cloudflare challenge page (blocked)"), OSError("proxy down"), VALID_HTML],
            ) as fetch,
        ):
            result = leo_service.lookup("Fortschritt", max_results=5)

        self.assertEqual([call.args[1] for call in fetch.call_args_list], ["http://last", "http://bad", "http://good"])
        save_proxy.assert_called_once_with("http://good")
        self.assertEqual(result["entries"][0]["sides"][1]["text"], "progreso")

    def test_webshare_candidates_are_distinct_and_capped(self):
        with (
            patch.object(leo_service, "get_leo_last_working_proxy", return_value="http://saved"),
            patch.object(leo_service, "get_youtube_proxy_url", return_value="http://user:pass@p.webshare.io:80"),
            patch.object(leo_service, "is_sticky_supported", return_value=True),
            patch.object(leo_service.secrets, "token_hex", side_effect=[f"token{i}" for i in range(20)]),
        ):
            candidates = leo_service._proxy_candidates()

        cap = leo_service._MAX_PROXY_ATTEMPTS
        self.assertEqual(len(candidates), cap)
        self.assertEqual(candidates[0], "http://saved")
        self.assertEqual(len(set(candidates)), cap)
        self.assertTrue(all("-session-token" in proxy for proxy in candidates[1:]))

    def test_unsupported_sticky_retries_the_normal_rotating_endpoint(self):
        base_proxy = "http://user:pass@p.webshare.io:80"
        saved_session = "http://user-session-old:pass@p.webshare.io:80"
        with (
            patch.object(leo_service, "get_leo_last_working_proxy", return_value=saved_session),
            patch.object(leo_service, "get_youtube_proxy_url", return_value=base_proxy),
            patch.object(leo_service, "is_sticky_supported", return_value=False),
        ):
            candidates = leo_service._proxy_candidates()

        self.assertEqual(candidates, [base_proxy] * leo_service._MAX_PROXY_ATTEMPTS)

    def test_unsupported_sticky_keeps_distinct_configured_proxies_first(self):
        base_proxy = "http://user:pass@p.webshare.io:80"
        with (
            patch.object(leo_service, "get_leo_last_working_proxy", return_value=None),
            patch.object(
                leo_service,
                "get_youtube_proxy_url",
                return_value=f"http://one,{base_proxy},http://two",
            ),
            patch.object(leo_service, "is_sticky_supported", return_value=False),
        ):
            candidates = leo_service._proxy_candidates()

        self.assertEqual(candidates[:3], ["http://one", base_proxy, "http://two"])
        self.assertEqual(candidates[3:], [base_proxy] * (leo_service._MAX_PROXY_ATTEMPTS - 3))

    def test_407_from_a_sticky_proxy_disables_sessions_and_falls_back(self):
        base_proxy = "http://user:pass@p.webshare.io:80"
        with (
            patch.object(leo_service, "get_leo_last_working_proxy", return_value=None),
            patch.object(leo_service, "get_youtube_proxy_url", return_value=base_proxy),
            patch.object(leo_service, "is_sticky_supported", return_value=True),
            patch.object(leo_service.secrets, "token_hex", side_effect=["first", *[f"unused{i}" for i in range(9)]]),
            patch.object(leo_service, "mark_sticky_unsupported") as mark_unsupported,
            patch.object(leo_service, "set_leo_last_working_proxy") as save_proxy,
            patch.object(
                leo_service,
                "_fetch_html",
                side_effect=[RuntimeError("407 Proxy Authentication Required"), VALID_HTML],
            ) as fetch,
        ):
            result = leo_service.lookup("Fortschritt", max_results=5)

        self.assertEqual(fetch.call_args_list[0].args[1], "http://user-session-first:pass@p.webshare.io:80")
        self.assertEqual(fetch.call_args_list[1].args[1], base_proxy)
        mark_unsupported.assert_called_once_with()
        save_proxy.assert_called_once_with(base_proxy)
        self.assertEqual(result["entries"][0]["sides"][1]["text"], "progreso")

    def test_lookup_raises_only_after_every_candidate_fails(self):
        """Tier 1 exhausted -> tier 2 (headless browser) also exhausted -> access error."""
        candidates = ["http://one", "http://two", "http://three"]
        with (
            patch.object(leo_service, "_proxy_candidates", return_value=candidates),
            patch.object(leo_service, "_fetch_html", side_effect=OSError("proxy unavailable")) as fetch,
            patch.object(
                leo_service,
                "_playwright_candidates",
                return_value=["http://one"],
            ),
            patch.object(
                leo_service, "_fetch_html_playwright", side_effect=RuntimeError("browser also blocked")
            ) as fetch_pw,
        ):
            with self.assertRaisesRegex(leo_service.LeoLookupError, "direct \\+ proxies \\+ browser"):
                leo_service.lookup("Fortschritt")

        # Tier 1 also always appends a guaranteed direct (no-proxy) attempt.
        self.assertEqual([call.args[1] for call in fetch.call_args_list], candidates + [None])
        fetch_pw.assert_called_once()


if __name__ == "__main__":
    unittest.main()
