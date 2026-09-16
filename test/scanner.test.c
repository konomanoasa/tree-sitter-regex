#include <assert.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#include REGEX_SCANNER_SOURCE

#define TOKEN_COUNT (ERROR_SENTINEL + 1)

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
  if (mock->offset < mock->length)
    mock->offset++;
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
  memset(guarded, 0x5a, sizeof(guarded));
  unsigned length = REGEX_SCANNER(serialize)(scanner, guarded + 1);
  assert(length <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
  assert(guarded[0] == 0x5a);
  for (size_t index = length + 1; index < sizeof(guarded); index++) {
    assert(guarded[index] == 0x5a);
  }
  memcpy(buffer, guarded + 1, length);
  return length;
}

static void assert_scans_decline(void *scanner, const bool *valid_symbols) {
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned before_length = serialize_state(scanner, before);
  const struct {
    const char *source;
    size_t length;
  } inputs[] = {
    {"(?<x>a)", 7},
    {"(?i)a", 5},
    {"3", 1},
    {"u0041", 5},
    {"#comment", 8},
    {"[", 1},
    {"*", 1},
    {" ", 1},
    {"", 0},
    {"\0", 1},
  };
  for (size_t index = 0; index < sizeof(inputs) / sizeof(inputs[0]); index++) {
    MockLexer mock = make_lexer(inputs[index].source, inputs[index].length);
    assert(!REGEX_SCANNER(scan)(scanner, &mock.lexer, valid_symbols));
    char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned after_length = serialize_state(scanner, after);
    assert(after_length == before_length);
    assert(memcmp(before, after, before_length) == 0);
  }
}

static void test_disabled_and_recovery_scans_preserve_state(void) {
  void *scanner = REGEX_SCANNER(create)();
#if defined(JAVASCRIPT_REGEX_MODE) && JAVASCRIPT_REGEX_MODE == 0
  *(Scanner *)scanner =
    (Scanner){.capture_count = 2, .has_named_capture = true};
#endif
  bool valid_symbols[TOKEN_COUNT] = {false};
  assert_scans_decline(scanner, valid_symbols);
  for (size_t index = 0; index < TOKEN_COUNT; index++) {
    valid_symbols[index] = true;
  }
  assert_scans_decline(scanner, valid_symbols);
  REGEX_SCANNER(destroy)(scanner);
}

#if defined(JAVASCRIPT_REGEX_MODE)
static void check_token(
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

#if JAVASCRIPT_REGEX_MODE == 0
static void test_serialization_and_reset(void) {
  Scanner *scanner = REGEX_SCANNER(create)();
  assert(scanner != NULL);
  const uint32_t counts[] = {0, 1, 255, 256, 65535, 65536, UINT32_MAX};
  for (size_t index = 0; index < sizeof(counts) / sizeof(counts[0]); index++) {
    for (unsigned flags = 0; flags < 2; flags++) {
      *scanner = (Scanner){
        .capture_count = counts[index],
        .has_named_capture = flags != 0
      };
      char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      unsigned length = serialize_state(scanner, buffer);
      assert(length == 5);
      Scanner restored = {0};
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
  check_token(&scanner, source, sizeof(source) - 1, PATTERN_START, true, 0);
  assert(scanner.capture_count == 2 && scanner.has_named_capture);
  check_token(&scanner, "2", 1, DECIMAL_START, true, 1);
  Scanner expected = scanner;
  check_token(&scanner, "3", 1, DECIMAL_START, false, 0);
  assert(scanner.capture_count == expected.capture_count);
  assert(scanner.has_named_capture == expected.has_named_capture);
  check_token(&scanner, "", 0, PATTERN_START, true, 0);
  assert(scanner.capture_count == 0 && !scanner.has_named_capture);
}

static void test_capture_context_stops_at_the_lexer_boundary(void) {
  Scanner scanner = {0};
  const struct {
    const char *source;
    size_t length;
    uint32_t captures;
    bool named;
  } cases[] = {
    {"\\1/; /(?<outside>a)/", 2, 0, false},
    {"\0(?<x>a)", 8, 1, true},
    {"\0(?<x>a)", 0, 0, false},
    {"(?<x>a)/; /(b)/", 7, 1, true},
    {"\\1()/; /(?<outside>a)/", 4, 1, false},
    {"\\1/; /(?<outside>a)/", 2, 0, false},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    check_token(
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
  memset(buffer, 0x5a, sizeof(buffer));
  assert(serialize_state(scanner, buffer) == 0);
  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  check_token(scanner, "0", 1, NULL_ZERO, true, 1);
  check_token(scanner, "01", 2, NULL_ZERO, false, 0);
  check_token(scanner, "x41", 3, HEX_START, true, 1);
  check_token(scanner, "x4", 2, HEX_START, false, 0);
  check_token(scanner, "uD800\\uDC00", 11, UNICODE_PAIR_START, true, 1);
  check_token(scanner, "uD800", 5, UNICODE_LEAD_START, true, 1);
  check_token(scanner, "uDC00", 5, UNICODE_TRAIL_START, true, 1);
  check_token(scanner, "u0041", 5, UNICODE_NON_SURROGATE_START, true, 1);
  check_token(scanner, "u{000010FFFF}", 13, UNICODE_CODE_POINT_START, true, 1);
  check_token(scanner, "u{110000}", 9, UNICODE_CODE_POINT_START, false, 0);
  check_token(
    scanner,
    "u{999999999999999999999}",
    24,
    UNICODE_CODE_POINT_START,
    false,
    0
  );
  check_token(scanner, "\\uDC00", 6, UNICODE_PAIR_SEPARATOR, true, 2);
#if JAVASCRIPT_REGEX_MODE == 2
  check_token(scanner, "&&x", 3, CLASS_INTERSECTION, true, 2);
  check_token(scanner, "&&&", 3, CLASS_INTERSECTION, false, 0);
  check_token(scanner, "!!", 2, CLASS_SET_RAW_CHARACTER, false, 0);
  check_token(scanner, "--x", 3, CLASS_SUBTRACTION, true, 2);
  check_token(scanner, "\0", 1, CLASS_SET_RAW_CHARACTER, true, 1);
  check_token(scanner, "", 0, CLASS_SET_RAW_CHARACTER, false, 0);
#endif
  REGEX_SCANNER(destroy)(scanner);
}
#endif

#else
static void assert_token(const char *source, TSSymbol token, size_t length) {
  MockLexer mock = make_lexer(source, strlen(source));
  bool valid_symbols[TOKEN_COUNT] = {false};
  valid_symbols[token] = true;
  assert(REGEX_SCANNER(scan)(NULL, &mock.lexer, valid_symbols));
  assert(mock.lexer.result_symbol == token);
  assert(mock.mark == length);
}

static void test_stateless_lifecycle_and_serialization(void) {
  void *scanner = REGEX_SCANNER(create)();
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, 0x5a, sizeof(buffer));
  assert(serialize_state(scanner, buffer) == 0);
  for (unsigned index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == 0x5a);
  }
  REGEX_SCANNER(deserialize)(scanner, NULL, 0);
  REGEX_SCANNER(deserialize)(scanner, buffer, sizeof(buffer));
  REGEX_SCANNER(destroy)(scanner);
}

static void test_token_ranges_follow_the_grammar_context(void) {
  static const struct {
    const char *source;
    TSSymbol token;
    size_t length;
  } cases[] = {
    {" ", LITERAL_CHARACTER_NORMAL, 1},
    {"#", LITERAL_CHARACTER_NORMAL, 1},
    {" ", CLASS_CHARACTER, 1},
    {"#", CLASS_CHARACTER, 1},
    {"[", CLASS_START, 1},
    {"^", CLASS_NEGATION, 1},
    {"]", CLASS_LEADING_CLOSE, 1},
    {"]", CLASS_CLOSE, 1},
    {"a", LITERAL_CHARACTER_VERBOSE, 1},
    {"(?ix)", GLOBAL_FLAGS_START, 1},
    {"(?i-x:", SCOPED_FLAGS_START, 1},
    {"ix", ENABLE_FLAGS_WITH_X, 2},
    {"mi", ENABLE_FLAGS_WITHOUT_X, 2},
    {"sx", DISABLE_FLAGS_WITH_X, 2},
    {"ms", DISABLE_FLAGS_WITHOUT_X, 2},
    {"name>", ANGLE_GROUP_NAME, 4},
    {"name)", PARENTHESIZED_GROUP_NAME, 4},
    {"123)", CONDITIONAL_GROUP_ID, 3},
    {"EM DASH}", UNICODE_CHARACTER_NAME, 7},
    {"\\x01", HEX_ESCAPE_START, 2},
    {"\\u0123", UNICODE_ESCAPE_SHORT_START, 2},
    {"\\U00001234", UNICODE_ESCAPE_LONG_START, 2},
    {"\\N{EM DASH}", NAMED_UNICODE_ESCAPE_START, 2},
    {"\\123", OUTSIDE_NUMERIC_ESCAPE_START, 1},
    {"\\123", CLASS_NUMERIC_ESCAPE_START, 1},
    {"\\#", LITERAL_ESCAPE, 2},
    {"{,}", OPEN_BRACE, 1},
    {"{12}", OPEN_BRACE, 1},
    {"{12,}", OPEN_BRACE, 1},
    {"{,12}", OPEN_BRACE, 1},
    {"{1,2}", OPEN_BRACE, 1},
    {"{", LITERAL_CHARACTER_NORMAL, 1},
    {"{1", LITERAL_CHARACTER_VERBOSE, 1},
    {"{ 1}", LITERAL_CHARACTER_NORMAL, 1},
    {"a\\)b)c", COMMENT_GROUP_CONTENT, 4},
    {"a\\\\)b", COMMENT_GROUP_CONTENT, 3},
    {"#a\\\nb\nc", VERBOSE_COMMENT, 5},
    {"#a\\\\\nb", VERBOSE_COMMENT, 4},
    {"#a\\\r\nb", VERBOSE_COMMENT, 4},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    assert_token(cases[index].source, cases[index].token, cases[index].length);
  }
}

static void test_invalid_tokens_are_not_emitted(void) {
  static const struct {
    const char *source;
    TSSymbol token;
  } cases[] = {
    {" ", LITERAL_CHARACTER_VERBOSE},
    {"#", LITERAL_CHARACTER_VERBOSE},
    {">", ANGLE_GROUP_NAME},
    {"}", UNICODE_CHARACTER_NAME},
    {"\\x0", HEX_ESCAPE_START},
    {"\\u123", UNICODE_ESCAPE_SHORT_START},
    {"\\U1234567", UNICODE_ESCAPE_LONG_START},
    {"\\Nname}", NAMED_UNICODE_ESCAPE_START},
    {"\\8", CLASS_NUMERIC_ESCAPE_START},
    {"\\q", LITERAL_ESCAPE},
    {"(?i)", SCOPED_FLAGS_START},
    {"(?x:", GLOBAL_FLAGS_START},
    {"{1}", LITERAL_CHARACTER_NORMAL},
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

static void test_nul_and_eof_are_distinct(void) {
  const TSSymbol tokens[] =
    {LITERAL_CHARACTER_NORMAL, LITERAL_CHARACTER_VERBOSE, CLASS_CHARACTER};
  for (size_t index = 0; index < sizeof(tokens) / sizeof(tokens[0]); index++) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[tokens[index]] = true;
    MockLexer nul = make_lexer("\0", 1);
    assert(REGEX_SCANNER(scan)(NULL, &nul.lexer, valid_symbols));
    assert(nul.lexer.result_symbol == tokens[index]);
    assert(nul.mark == 1);
    MockLexer eof = make_lexer("", 0);
    assert(!REGEX_SCANNER(scan)(NULL, &eof.lexer, valid_symbols));
  }
}

#endif

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static void test_reuse_allocator_contract(void) {
#if JAVASCRIPT_REGEX_MODE == 0
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
  test_disabled_and_recovery_scans_preserve_state();
#if defined(JAVASCRIPT_REGEX_MODE)
#if JAVASCRIPT_REGEX_MODE == 0
  test_serialization_and_reset();
  test_capture_context_and_failed_scan();
  test_capture_context_stops_at_the_lexer_boundary();
#else
  test_stateless_lifecycle_and_unicode_tokens();
#endif
#else
  test_stateless_lifecycle_and_serialization();
  test_token_ranges_follow_the_grammar_context();
  test_invalid_tokens_are_not_emitted();
  test_nul_and_eof_are_distinct();
#endif
#ifdef TREE_SITTER_REUSE_ALLOCATOR
  test_reuse_allocator_contract();
#endif
  return 0;
}
