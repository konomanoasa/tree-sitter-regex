from importlib.resources import files

from .binding import (
    language_ecmaregex,
    language_ecmaregex_u,
    language_ecmaregex_v,
    language_pcre2,
    language_posix_bre,
    language_posix_ere,
    language_pyregex,
    language_pyregex_verbose,
)

HIGHLIGHTS_QUERY_ECMAREGEX: str = (
    files(__package__)
    .joinpath("queries_ecmaregex/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_ECMAREGEX_U: str = (
    files(__package__)
    .joinpath("queries_ecmaregex_u/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_ECMAREGEX_V: str = (
    files(__package__)
    .joinpath("queries_ecmaregex_v/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_PCRE2: str = (
    files(__package__)
    .joinpath("queries_pcre2/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_POSIX_BRE: str = (
    files(__package__)
    .joinpath("queries_posix_bre/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_POSIX_ERE: str = (
    files(__package__)
    .joinpath("queries_posix_ere/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_PYREGEX: str = (
    files(__package__)
    .joinpath("queries_pyregex/highlights.scm")
    .read_text("utf-8")
)
HIGHLIGHTS_QUERY_PYREGEX_VERBOSE: str = (
    files(__package__)
    .joinpath("queries_pyregex_verbose/highlights.scm")
    .read_text("utf-8")
)

__all__ = [
    "HIGHLIGHTS_QUERY_ECMAREGEX",
    "HIGHLIGHTS_QUERY_ECMAREGEX_U",
    "HIGHLIGHTS_QUERY_ECMAREGEX_V",
    "HIGHLIGHTS_QUERY_PCRE2",
    "HIGHLIGHTS_QUERY_POSIX_BRE",
    "HIGHLIGHTS_QUERY_POSIX_ERE",
    "HIGHLIGHTS_QUERY_PYREGEX",
    "HIGHLIGHTS_QUERY_PYREGEX_VERBOSE",
    "language_ecmaregex",
    "language_ecmaregex_u",
    "language_ecmaregex_v",
    "language_pcre2",
    "language_posix_bre",
    "language_posix_ere",
    "language_pyregex",
    "language_pyregex_verbose",
]
