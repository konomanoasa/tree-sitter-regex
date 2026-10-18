#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include REGEX_SCANNER_SOURCE

#ifdef PCRE2_SCANNER
#define REGEX_SCANNER(suffix) tree_sitter_pcre2_external_scanner_##suffix
#endif

#define TOKEN_COUNT (ERROR_SENTINEL + 1)

enum { SERIALIZATION_GUARD_BYTE = 0x5a };

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static size_t reuse_calloc_calls;
static size_t reuse_free_calls;
static size_t reuse_live_allocations;
static bool reuse_fail_next_calloc;

static void *reuse_calloc(size_t count, size_t size) {
  reuse_calloc_calls += 1;
  if (reuse_fail_next_calloc) {
    reuse_fail_next_calloc = false;
    return NULL;
  }
  void *result = calloc(count, size);
  if (result != NULL) {
    reuse_live_allocations += 1;
  }
  return result;
}

static void reuse_free(void *allocation) {
  reuse_free_calls += 1;
  if (allocation != NULL) {
    assert(reuse_live_allocations > 0);
    reuse_live_allocations -= 1;
  }
  free(allocation);
}

void *(*ts_current_calloc)(size_t, size_t) = reuse_calloc;
void (*ts_current_free)(void *) = reuse_free;
#endif

typedef struct {
  TSLexer lexer;
  const char *source;
  size_t length;
  size_t offset;
  size_t mark;
} MockLexer;

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  MockLexer *mock = (MockLexer *)lexer;
  if (mock->offset < mock->length) mock->offset++;
  lexer->lookahead =
    mock->offset < mock->length ? (unsigned char)mock->source[mock->offset] : 0;
}

static void mock_mark_end(TSLexer *lexer) {
  MockLexer *mock = (MockLexer *)lexer;
  mock->mark = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const MockLexer *mock = (const MockLexer *)lexer;
  return mock->offset == mock->length;
}

static MockLexer make_lexer(const char *source, size_t length) {
  return (MockLexer){
    .lexer =
      {.lookahead = length ? (unsigned char)source[0] : 0,
        .result_symbol = UINT16_MAX,
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .eof = mock_eof},
    .source = source,
    .length = length,
    .mark = SIZE_MAX,
  };
}

static unsigned serialize_state(void *scanner, char *buffer) {
  char guarded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE + 2];
  memset(guarded, SERIALIZATION_GUARD_BYTE, sizeof(guarded));
  unsigned length = REGEX_SCANNER(serialize)(scanner, guarded + 1);
  assert(length <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
  assert(guarded[0] == SERIALIZATION_GUARD_BYTE);
  for (size_t index = length + 1; index < sizeof(guarded); index++) {
    assert(guarded[index] == SERIALIZATION_GUARD_BYTE);
  }
  memcpy(buffer, guarded + 1, length);
  return length;
}

static void assert_scan_declines(
  void *scanner,
  const bool *valid_symbols,
  const char *source,
  size_t source_length
) {
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned before_length = serialize_state(scanner, before);
  MockLexer mock = make_lexer(source, source_length);
  assert(!REGEX_SCANNER(scan)(scanner, &mock.lexer, valid_symbols));
  char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned after_length = serialize_state(scanner, after);
  assert(after_length == before_length);
  assert(memcmp(before, after, before_length) == 0);
}

static void assert_scans_decline(void *scanner, const bool *valid_symbols) {
  const char *sources[] =
    {"(?<x>a)", "(?i)a", "3", "u0041", "#comment", "[", "*", " ", ""};
  for (
    size_t index = 0; index < sizeof(sources) / sizeof(sources[0]); index++
  ) {
    assert_scan_declines(
      scanner,
      valid_symbols,
      sources[index],
      strlen(sources[index])
    );
  }
  const char nul[] = "\0";
  assert_scan_declines(scanner, valid_symbols, nul, sizeof(nul) - 1);
}

static void test_disabled_and_blocked_recovery_scans_preserve_state(void) {
  void *scanner = REGEX_SCANNER(create)();
#if defined(JS_REGEX_MODE) && JS_REGEX_MODE == 0
  *(Scanner *)scanner =
    (Scanner){.capture_count = 2, .has_named_capture = true};
#elif defined(PCRE2_SCANNER)
  ((Scanner *)scanner)->can_recover_pattern = false;
#endif
  bool valid_symbols[TOKEN_COUNT] = {false};
  assert_scans_decline(scanner, valid_symbols);
  for (size_t index = 0; index < TOKEN_COUNT; index++) {
    valid_symbols[index] = true;
  }
  assert_scans_decline(scanner, valid_symbols);
  REGEX_SCANNER(destroy)(scanner);
}

#if (defined(JS_REGEX_MODE) && JS_REGEX_MODE == 0) || defined(PCRE2_SCANNER)
static void test_unallocated_payload_declines_without_state(void) {
  void *scanner = REGEX_SCANNER(create)();
#if defined(JS_REGEX_MODE) && JS_REGEX_MODE == 0
  ((Scanner *)scanner)->capture_count = 1;
#endif
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = serialize_state(scanner, buffer);
  assert(length > 0);
  REGEX_SCANNER(destroy)(scanner);
  REGEX_SCANNER(deserialize)(NULL, buffer, length);
  REGEX_SCANNER(deserialize)(NULL, NULL, 0);
  bool valid_symbols[TOKEN_COUNT] = {false};
  for (size_t index = 0; index < ERROR_SENTINEL; index++) {
    valid_symbols[index] = true;
  }
  assert_scans_decline(NULL, valid_symbols);
  REGEX_SCANNER(destroy)(NULL);
}
#endif

#if defined(POSIX_REGEX_MODE) || defined(PYTHON_RE_LANGUAGE)
static void test_stateless_lifecycle_and_serialization(void) {
  void *scanner = REGEX_SCANNER(create)();
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, SERIALIZATION_GUARD_BYTE, sizeof(buffer));
  assert(serialize_state(scanner, buffer) == 0);
  for (unsigned index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == SERIALIZATION_GUARD_BYTE);
  }
  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  REGEX_SCANNER(deserialize)(scanner, buffer, sizeof(buffer));
  REGEX_SCANNER(destroy)(scanner);
}
#endif

#if defined(JS_REGEX_MODE)
static void check_token_bytes(
  void *scanner,
  const char *source,
  size_t length,
  TSSymbol token,
  bool accepted,
  size_t end
) {
  MockLexer mock = make_lexer(source, length);
  bool valid[TOKEN_COUNT] = {false};
  valid[token] = true;
  assert(REGEX_SCANNER(scan)(scanner, &mock.lexer, valid) == accepted);
  if (accepted) {
    assert(mock.lexer.result_symbol == token);
    assert((mock.mark == SIZE_MAX ? mock.offset : mock.mark) == end);
  }
}

static void check_token(
  void *scanner,
  const char *source,
  TSSymbol token,
  bool accepted,
  size_t end
) {
  check_token_bytes(scanner, source, strlen(source), token, accepted, end);
}

#if JS_REGEX_MODE == 0
static void test_serialization_and_reset(void) {
  Scanner *scanner = REGEX_SCANNER(create)();
  assert(scanner != NULL);
  const uint32_t counts[] = {
    0,
    1,
    UINT8_MAX,
    (uint32_t)UINT8_MAX + 1,
    UINT16_MAX,
    (uint32_t)UINT16_MAX + 1,
    UINT32_MAX
  };
  for (size_t index = 0; index < sizeof(counts) / sizeof(counts[0]); index++) {
    for (unsigned flags = 0; flags < 2; flags++) {
      *scanner = (Scanner){
        .capture_count = counts[index],
        .has_named_capture = flags != 0
      };
      char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      unsigned length = serialize_state(scanner, buffer);
      assert((length == 0) == (counts[index] == 0 && flags == 0));
      Scanner restored = {
        .capture_count = UINT32_MAX,
        .has_named_capture = true
      };
      REGEX_SCANNER(deserialize)(&restored, buffer, length);
      assert(restored.capture_count == counts[index]);
      assert(restored.has_named_capture == scanner->has_named_capture);
    }
  }
  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  assert(scanner->capture_count == 0 && !scanner->has_named_capture);
  REGEX_SCANNER(destroy)(scanner);
}

static void test_capture_context_and_failed_scan(void) {
  Scanner scanner = {0};
  const char source[] = "\\1[(a)](?<x>b)(?:c)(?<=d)(e)";
  check_token_bytes(
    &scanner,
    source,
    sizeof(source) - 1,
    PATTERN_START,
    true,
    0
  );
  assert(scanner.capture_count == 2 && scanner.has_named_capture);
  check_token(&scanner, "2", DECIMAL_START, true, 1);
  Scanner expected = scanner;
  check_token(&scanner, "3", DECIMAL_START, false, 0);
  assert(scanner.capture_count == expected.capture_count);
  assert(scanner.has_named_capture == expected.has_named_capture);
  check_token(&scanner, "", PATTERN_START, true, 0);
  assert(scanner.capture_count == 0 && !scanner.has_named_capture);
}

static void test_capture_context_stops_at_the_lexer_boundary(void) {
  Scanner scanner = {0};
  const char nul_before_capture[] = "\0(?<x>a)";
  const struct {
    const char *source;
    size_t length;
    uint32_t captures;
    bool named;
  } cases[] = {
    {"\\1/; /(?<outside>a)/", 2, 0, false},
    {nul_before_capture, sizeof(nul_before_capture) - 1, 1, true},
    {nul_before_capture, 0, 0, false},
    {"(?<x>a)/; /(b)/", 7, 1, true},
    {"\\1()/; /(?<outside>a)/", 4, 1, false},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    check_token_bytes(
      &scanner,
      cases[i].source,
      cases[i].length,
      PATTERN_START,
      true,
      0
    );
    assert(scanner.capture_count == cases[i].captures);
    assert(scanner.has_named_capture == cases[i].named);
  }
}
#else
static void test_stateless_lifecycle_and_unicode_tokens(void) {
  void *scanner = REGEX_SCANNER(create)();
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, SERIALIZATION_GUARD_BYTE, sizeof(buffer));
  assert(serialize_state(scanner, buffer) == 0);
  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  check_token(scanner, "0", NULL_ZERO, true, 1);
  check_token(scanner, "01", NULL_ZERO, false, 0);
  check_token(scanner, "x41", HEX_START, true, 1);
  check_token(scanner, "x4", HEX_START, false, 0);
  check_token(scanner, "uD800\\uDC00", UNICODE_PAIR_START, true, 1);
  check_token(scanner, "uD800", UNICODE_LEAD_START, true, 1);
  check_token(scanner, "uDC00", UNICODE_TRAIL_START, true, 1);
  check_token(scanner, "u0041", UNICODE_NON_SURROGATE_START, true, 1);
  check_token(scanner, "u{000010FFFF}", UNICODE_CODE_POINT_START, true, 1);
  check_token(scanner, "u{110000}", UNICODE_CODE_POINT_START, false, 0);
  check_token(
    scanner,
    "u{999999999999999999999}",
    UNICODE_CODE_POINT_START,
    false,
    0
  );
  check_token(scanner, "\\uDC00", UNICODE_PAIR_SEPARATOR, true, 2);
#if JS_REGEX_MODE == 2
  const char nul[] = "\0";
  check_token(scanner, "&&x", CLASS_INTERSECTION, true, 2);
  check_token(scanner, "&&&", CLASS_INTERSECTION, false, 0);
  check_token(scanner, "!!", CLASS_SET_RAW_CHARACTER, false, 0);
  check_token(scanner, "--x", CLASS_SUBTRACTION, true, 2);
  check_token_bytes(
    scanner,
    nul,
    sizeof(nul) - 1,
    CLASS_SET_RAW_CHARACTER,
    true,
    1
  );
  check_token(scanner, "", CLASS_SET_RAW_CHARACTER, false, 0);
#endif
  REGEX_SCANNER(destroy)(scanner);
}
#endif

#elif defined(POSIX_REGEX_MODE)
static void enable_compound_payload(bool *valid_symbols, bool collating) {
  if (collating) {
    valid_symbols[COLLATING_SYMBOL_SINGLE] = true;
    valid_symbols[COLLATING_SYMBOL_MULTI] = true;
    valid_symbols[COLLATING_SYMBOL_META] = true;
  } else {
    valid_symbols[EQUIVALENCE_CLASS_SINGLE] = true;
    valid_symbols[EQUIVALENCE_CLASS_MULTI] = true;
  }
}

static void test_compound_payloads_end_at_their_closer_or_the_input_end(void) {
  static const struct {
    const char *source;
    bool collating;
    TSSymbol token;
    size_t length;
  } cases[] = {
    {"a.]", true, COLLATING_SYMBOL_SINGLE, 1},
    {"ch.]", true, COLLATING_SYMBOL_MULTI, 2},
    {"a.b.]", true, COLLATING_SYMBOL_MULTI, 3},
    {"].]", true, COLLATING_SYMBOL_META, 1},
    {"^.]", true, COLLATING_SYMBOL_META, 1},
    {"-.]", true, COLLATING_SYMBOL_META, 1},
    {"a=]", false, EQUIVALENCE_CLASS_SINGLE, 1},
    {"ch=]", false, EQUIVALENCE_CLASS_MULTI, 2},
    {"^=]", false, EQUIVALENCE_CLASS_SINGLE, 1},
    {"a", true, COLLATING_SYMBOL_SINGLE, 1},
    {"^", true, COLLATING_SYMBOL_META, 1},
    {"abc", true, COLLATING_SYMBOL_MULTI, 3},
    {"a.", true, COLLATING_SYMBOL_MULTI, 2},
    {"a=]", true, COLLATING_SYMBOL_MULTI, 3},
    {"^", false, EQUIVALENCE_CLASS_SINGLE, 1},
    {"a=", false, EQUIVALENCE_CLASS_MULTI, 2},
    {"a.]", false, EQUIVALENCE_CLASS_MULTI, 3},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    enable_compound_payload(valid_symbols, cases[index].collating);
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == cases[index].length);
  }
}

static void test_empty_payloads_are_not_emitted(void) {
  static const struct {
    const char *source;
    bool collating;
  } cases[] = {
    {".]", true},
    {"=]", false},
    {"", true},
    {"", false},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    enable_compound_payload(valid_symbols, cases[index].collating);
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(!REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
  }
}

static void test_compound_payloads_respect_enabled_token_types(void) {
  static const struct {
    const char *source;
    TSSymbol enabled;
    bool emitted;
  } cases[] = {
    {"^.]", COLLATING_SYMBOL_META, true},
    {"a.]", COLLATING_SYMBOL_SINGLE, true},
    {"ab.]", COLLATING_SYMBOL_MULTI, true},
    {"ab.]", COLLATING_SYMBOL_SINGLE, false},
    {"a.]", COLLATING_SYMBOL_MULTI, false},
    {"^.]", COLLATING_SYMBOL_SINGLE, false},
    {"a=]", EQUIVALENCE_CLASS_SINGLE, true},
    {"ab=]", EQUIVALENCE_CLASS_SINGLE, false},
    {"a=]", EQUIVALENCE_CLASS_MULTI, false},
  };
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[cases[index].enabled] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(
      REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols) ==
      cases[index].emitted
    );
    if (cases[index].emitted)
      assert(mock.lexer.result_symbol == cases[index].enabled);
  }
}

#if POSIX_REGEX_MODE == 0
static void test_right_anchor_requires_eof(void) {
  static const struct {
    const char *source;
    bool emitted;
  } cases[] = {
    {"$", true},
    {"$\\|", false},
    {"$a", false},
    {"$\\", false},
    {"$\\(", false},
    {"$\\)", false},
    {"a$", false},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[BRE_RIGHT_ANCHOR] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    if (!cases[index].emitted) {
      assert(!REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
      continue;
    }
    assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
    assert(mock.lexer.result_symbol == BRE_RIGHT_ANCHOR);
    assert(mock.mark == 1);
  }
}
#endif

static void test_trailing_bracket_hyphen_requires_a_closing_bracket(void) {
  static const struct {
    const char *source;
    bool emitted;
  } cases[] = {
    {"-]", true},
    {"-a", false},
    {"-", false},
    {"--]", false},
    {"a]", false},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[TRAILING_BRACKET_HYPHEN] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    if (!cases[index].emitted) {
      assert(!REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
      continue;
    }
    assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
    assert(mock.lexer.result_symbol == TRAILING_BRACKET_HYPHEN);
    assert(mock.mark == 1);
  }
}

static void test_literal_bracket_does_not_split_compound_openers(void) {
  static const struct {
    const char *source;
    bool emitted;
  } cases[] = {
    {"[", true},
    {"[]", true},
    {"[x", true},
    {"[.", false},
    {"[=", false},
    {"[:", false},
  };
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[BRACKET_OPEN_CHARACTER] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(
      REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols) ==
      cases[index].emitted
    );
    if (cases[index].emitted) {
      assert(mock.lexer.result_symbol == BRACKET_OPEN_CHARACTER);
      assert(mock.offset == 1);
    }
  }
}

#elif defined(PYTHON_RE_LANGUAGE)
static void assert_token(const char *source, TSSymbol token, size_t length) {
  MockLexer mock = make_lexer(source, strlen(source));
  bool valid_symbols[TOKEN_COUNT] = {false};
  valid_symbols[token] = true;
  assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
  assert(mock.lexer.result_symbol == token);
  assert(mock.mark == length);
}

static void test_token_ranges_follow_the_grammar_context(void) {
  static const struct {
    const char *source;
    TSSymbol token;
    size_t length;
  } cases[] = {
    {"{,}", OPEN_BRACE, 1},
    {"{12}", OPEN_BRACE, 1},
    {"{12,}", OPEN_BRACE, 1},
    {"{,12}", OPEN_BRACE, 1},
    {"{1,2}", OPEN_BRACE, 1},
    {"{", LITERAL_OPEN_BRACE, 1},
    {"{1", LITERAL_OPEN_BRACE, 1},
    {"{ 1}", LITERAL_OPEN_BRACE, 1},
    {"\\0", NUMERIC_ESCAPE_START, 1},
    {"\\377", NUMERIC_ESCAPE_START, 1},
    {"\\3770", NUMERIC_ESCAPE_START, 1},
    {"\\40", NUMERIC_ESCAPE_START, 1},
    {"\\40x", NUMERIC_ESCAPE_START, 1},
    {"\\408", NUMERIC_ESCAPE_START, 1},
    {"\\77", NUMERIC_ESCAPE_START, 1},
    {"\\8", NUMERIC_ESCAPE_START, 1},
    {"\\99", NUMERIC_ESCAPE_START, 1},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    assert_token(cases[index].source, cases[index].token, cases[index].length);
  }
  const char nul_source[] = "\0x";
  const char escaped_nul_source[] = "\\\0x";
  const struct {
    const char *source;
    size_t length;
    TSSymbol token;
    size_t end;
  } nul_cases[] = {
    {nul_source, sizeof(nul_source) - 1, NUL_CHARACTER, 1},
    {escaped_nul_source,
      sizeof(escaped_nul_source) - 1,
      ESCAPED_NUL_CHARACTER,
      2},
  };
  for (size_t i = 0; i < sizeof(nul_cases) / sizeof(nul_cases[0]); i++) {
    MockLexer mock = make_lexer(nul_cases[i].source, nul_cases[i].length);
    bool valid[TOKEN_COUNT] = {false};
    valid[nul_cases[i].token] = true;
    assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid));
    assert(mock.lexer.result_symbol == nul_cases[i].token);
    assert(mock.mark == nul_cases[i].end);
    assert(mock.offset == nul_cases[i].end);
  }
}

static void test_invalid_tokens_are_not_emitted(void) {
  static const struct {
    const char *source;
    TSSymbol token;
  } cases[] = {
    {"{1}", LITERAL_OPEN_BRACE},
    {"{ 1}", OPEN_BRACE},
    {"", OPEN_BRACE},
    {"", NUL_CHARACTER},
    {"", ESCAPED_NUL_CHARACTER},
    {"\\", ESCAPED_NUL_CHARACTER},
    {"\\a", ESCAPED_NUL_CHARACTER},
    {"\\400", NUMERIC_ESCAPE_START},
    {"\\777", NUMERIC_ESCAPE_START},
    {"\\4000", NUMERIC_ESCAPE_START},
    {"\\7777", NUMERIC_ESCAPE_START},
    {"", NUMERIC_ESCAPE_START},
    {"\\", NUMERIC_ESCAPE_START},
    {"\\a", NUMERIC_ESCAPE_START},
    {"\\ 400", NUMERIC_ESCAPE_START},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[cases[index].token] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(!REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
  }
}

#elif defined(PCRE2_SCANNER)
static bool scan_pcre2(void *scanner, const char *source, TSSymbol token) {
  MockLexer mock = make_lexer(source, strlen(source));
  bool valid[TOKEN_COUNT] = {false};
  valid[token] = true;
  bool emitted = REGEX_SCANNER(scan)(scanner, &mock.lexer, valid);
  if (emitted) assert(mock.lexer.result_symbol == token);
  return emitted;
}

static void check_pcre2_recovery(
  void *scanner,
  const char *source,
  TSSymbol token,
  size_t end
) {
  bool valid[TOKEN_COUNT];
  for (unsigned i = 0; i < TOKEN_COUNT; i++) valid[i] = true;
  if (token == ERROR_SENTINEL) {
    assert_scan_declines(scanner, valid, source, strlen(source));
    return;
  }
  MockLexer mock = make_lexer(source, strlen(source));
  assert(REGEX_SCANNER(scan)(scanner, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == token);
  assert((mock.mark == SIZE_MAX ? mock.offset : mock.mark) == end);
}

static void test_pcre2_recovery_respects_serialized_lexical_context(void) {
  void *scanner = REGEX_SCANNER(create)();
  void *restored = REGEX_SCANNER(create)();
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  const struct {
    const char *source;
    TSSymbol token;
  } blocked[] = {
    {"[", CLASS_OPEN},
    {"(?<name>", SCOPE_OPEN},
    {"(?#", ITEM_OPEN},
    {"\\g<", G_PREFIX},
    {"\\k<", K_PREFIX},
    {"\\c)", CONTROL_PREFIX},
    {"\\p{L}", PROPERTY_PREFIX},
    {"{2}", QUANTIFIER_OPEN},
  };
  for (unsigned i = 0; i < sizeof(blocked) / sizeof(blocked[0]); i++) {
    REGEX_SCANNER(deserialize)(scanner, NULL, 0);
    assert(scan_pcre2(scanner, "(", CAPTURE_OPEN));
    assert(scan_pcre2(scanner, "a", LITERAL_CHARACTER));
    assert(scan_pcre2(scanner, blocked[i].source, blocked[i].token));
    unsigned length = serialize_state(scanner, buffer);
    REGEX_SCANNER(deserialize)(restored, buffer, length);
    check_pcre2_recovery(restored, ")", ERROR_SENTINEL, 0);
    check_pcre2_recovery(restored, "|", ERROR_SENTINEL, 0);

    bool valid[TOKEN_COUNT] = {false};
    valid[PATTERN_CONTEXT] = true;
    assert_scan_declines(restored, valid, "", 0);
    MockLexer mock = make_lexer("*", 1);
    assert(REGEX_SCANNER(scan)(restored, &mock.lexer, valid));
    assert(mock.lexer.result_symbol == PATTERN_CONTEXT);
    assert(mock.offset == 0);
    assert_scan_declines(restored, valid, "*", 1);
    ((Scanner *)scanner)->can_recover_pattern = true;
    char expected[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned expected_length = serialize_state(scanner, expected);
    length = serialize_state(restored, buffer);
    assert(length == expected_length);
    assert(memcmp(buffer, expected, length) == 0);
    REGEX_SCANNER(deserialize)(scanner, buffer, length);
    check_pcre2_recovery(scanner, "|", PIPE, 1);
    check_pcre2_recovery(scanner, ")", SCOPE_CLOSE, 1);
  }

  for (unsigned in_class = 0; in_class < 2; in_class++) {
    REGEX_SCANNER(deserialize)(scanner, NULL, 0);
    assert(scan_pcre2(scanner, "(", CAPTURE_OPEN));
    bool valid[TOKEN_COUNT] = {false};
    valid[HEX_SHORT_PREFIX] = true;
    valid[CLASS_CHARACTER] = in_class;
    MockLexer mock = make_lexer("\\xG", 3);
    assert(REGEX_SCANNER(scan)(scanner, &mock.lexer, valid));
    assert(mock.lexer.result_symbol == HEX_SHORT_PREFIX);
    assert(mock.mark == 2);
    unsigned length = serialize_state(scanner, buffer);
    REGEX_SCANNER(deserialize)(restored, buffer, length);
    check_pcre2_recovery(restored, "G", ERROR_SENTINEL, 0);
    check_pcre2_recovery(restored, "4", ERROR_SENTINEL, 0);
    check_pcre2_recovery(restored, "|", in_class ? ERROR_SENTINEL : PIPE, 1);
    check_pcre2_recovery(
      restored,
      ")",
      in_class ? ERROR_SENTINEL : SCOPE_CLOSE,
      1
    );
  }

  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  assert(scan_pcre2(scanner, "(?|", SCOPE_OPEN));
  assert(scan_pcre2(scanner, "nxx", ENABLE_FLAGS));
  assert(scan_pcre2(scanner, "(?<name>", SCOPE_OPEN));
  assert(scan_pcre2(scanner, "a", LITERAL_CHARACTER));
  unsigned length = serialize_state(scanner, buffer);
  REGEX_SCANNER(deserialize)(restored, buffer, length);
  check_pcre2_recovery(restored, "\\j", ERROR_SENTINEL, 0);
  check_pcre2_recovery(restored, "\\Q", QUOTE_START, 2);
  length = serialize_state(restored, buffer);
  REGEX_SCANNER(deserialize)(scanner, buffer, length);
  check_pcre2_recovery(scanner, ")", LITERAL_CHARACTER, 1);
  check_pcre2_recovery(scanner, "|", LITERAL_CHARACTER, 1);
  check_pcre2_recovery(scanner, "\\E", QUOTE_END, 2);
  check_pcre2_recovery(scanner, ")", SCOPE_CLOSE, 1);
  check_pcre2_recovery(scanner, "|", PIPE, 1);
  assert(((Scanner *)scanner)->captures == 0);
  assert(((Scanner *)scanner)->flags == (NO_CAPTURE | EXTENDED_MORE));
  check_pcre2_recovery(scanner, ")", SCOPE_CLOSE, 1);
  assert(((Scanner *)scanner)->captures == 1);
  assert(((Scanner *)scanner)->flags == 0);
  check_pcre2_recovery(scanner, ")", ERROR_SENTINEL, 0);
  REGEX_SCANNER(destroy)(scanner);
  REGEX_SCANNER(destroy)(restored);
}

static void test_pcre2_complete_state_roundtrip_and_scope_limit(void) {
  const unsigned guaranteed_scope_depth = 1000;
  void *scanner = REGEX_SCANNER(create)();
  void *restored = REGEX_SCANNER(create)();
  assert(scan_pcre2(scanner, "(?|", SCOPE_OPEN));
  assert(scan_pcre2(scanner, "nxx", ENABLE_FLAGS));
  assert(scan_pcre2(scanner, "(?<name>", SCOPE_OPEN));
  assert(scan_pcre2(scanner, "\\Q", QUOTE_START));
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = serialize_state(scanner, before);
  REGEX_SCANNER(deserialize)(restored, before, length);
  assert(serialize_state(restored, after) == length);
  assert(memcmp(before, after, length) == 0);
  bool disabled[TOKEN_COUNT] = {false};
  assert_scans_decline(restored, disabled);
  assert(scan_pcre2(restored, "\\E", QUOTE_END));
  assert(scan_pcre2(restored, ")", SCOPE_CLOSE));
  assert(scan_pcre2(restored, "|", PIPE));
  assert(scan_pcre2(restored, ")", SCOPE_CLOSE));
  REGEX_SCANNER(deserialize)(restored, NULL, 0);
  for (unsigned i = 0; i < guaranteed_scope_depth; i++)
    assert(scan_pcre2(restored, "(?:", SCOPE_OPEN));
  unsigned count = guaranteed_scope_depth;
  for (; count < TREE_SITTER_SERIALIZATION_BUFFER_SIZE; count++) {
    if (!scan_pcre2(restored, "(?:", SCOPE_OPEN)) break;
  }
  assert(count < TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
  length = serialize_state(restored, before);
  assert(!scan_pcre2(restored, "(?:", SCOPE_OPEN));
  assert(serialize_state(restored, after) == length);
  assert(memcmp(before, after, length) == 0);
  REGEX_SCANNER(deserialize)(scanner, before, length);
  for (unsigned i = 0; i < count; i++)
    assert(scan_pcre2(scanner, ")", SCOPE_CLOSE));
  assert(!scan_pcre2(scanner, ")", SCOPE_CLOSE));
  REGEX_SCANNER(destroy)(scanner);
  REGEX_SCANNER(destroy)(restored);
}
#endif

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static void test_reuse_allocator_contract(void) {
#if (defined(JS_REGEX_MODE) && JS_REGEX_MODE == 0) || defined(PCRE2_SCANNER)
  assert(reuse_calloc_calls > 0);
  reuse_fail_next_calloc = true;
  assert(REGEX_SCANNER(create)() == NULL);
  assert(!reuse_fail_next_calloc);
#else
  assert(reuse_calloc_calls == 0);
#endif
  assert(reuse_free_calls > 0);
  assert(reuse_live_allocations == 0);
}
#endif

int main(void) {
  test_disabled_and_blocked_recovery_scans_preserve_state();
#if (defined(JS_REGEX_MODE) && JS_REGEX_MODE == 0) || defined(PCRE2_SCANNER)
  test_unallocated_payload_declines_without_state();
#endif
#if defined(JS_REGEX_MODE)
#if JS_REGEX_MODE == 0
  test_serialization_and_reset();
  test_capture_context_and_failed_scan();
  test_capture_context_stops_at_the_lexer_boundary();
#else
  test_stateless_lifecycle_and_unicode_tokens();
#endif
#elif defined(POSIX_REGEX_MODE)
  test_stateless_lifecycle_and_serialization();
  test_compound_payloads_end_at_their_closer_or_the_input_end();
  test_empty_payloads_are_not_emitted();
  test_compound_payloads_respect_enabled_token_types();
  test_trailing_bracket_hyphen_requires_a_closing_bracket();
  test_literal_bracket_does_not_split_compound_openers();
#if POSIX_REGEX_MODE == 0
  test_right_anchor_requires_eof();
#endif
#elif defined(PYTHON_RE_LANGUAGE)
  test_stateless_lifecycle_and_serialization();
  test_token_ranges_follow_the_grammar_context();
  test_invalid_tokens_are_not_emitted();
#elif defined(PCRE2_SCANNER)
  test_pcre2_recovery_respects_serialized_lexical_context();
  test_pcre2_complete_state_roundtrip_and_scope_limit();
#endif
#ifdef TREE_SITTER_REUSE_ALLOCATOR
  test_reuse_allocator_contract();
#endif
  return 0;
}
