#ifndef POSIX_REGEX_SCANNER_H
#define POSIX_REGEX_SCANNER_H

#include "../scanner.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef POSIX_REGEX_MODE
#error "POSIX_REGEX_MODE must select the POSIX regular-expression dialect"
#endif

#if POSIX_REGEX_MODE == 0
#define POSIX_REGEX_LANGUAGE posix_bre
#elif POSIX_REGEX_MODE == 1
#define POSIX_REGEX_LANGUAGE posix_ere
#else
#error "POSIX_REGEX_MODE must be 0 for BRE or 1 for ERE"
#endif

enum PosixRegexTokenType {
  COLLATING_SYMBOL_SINGLE,
  COLLATING_SYMBOL_MULTI,
  COLLATING_SYMBOL_META,
  EQUIVALENCE_CLASS_SINGLE,
  EQUIVALENCE_CLASS_MULTI,
  BRACKET_OPEN_CHARACTER,
  TRAILING_BRACKET_HYPHEN,
#if POSIX_REGEX_MODE == 0
  BRE_RIGHT_ANCHOR,
#endif
  ERROR_SENTINEL,
};

typedef struct {
  int32_t terminator;
  uint16_t single;
  uint16_t multi;
  bool allows_meta;
} PosixRegexCompound;

static const PosixRegexCompound posix_regex_compounds[] = {
  {'.', COLLATING_SYMBOL_SINGLE, COLLATING_SYMBOL_MULTI, true},
  {'=', EQUIVALENCE_CLASS_SINGLE, EQUIVALENCE_CLASS_MULTI, false},
};

static bool posix_regex_is_meta_character(int32_t character) {
  return character == '^' || character == '-' || character == ']';
}

// Declining at EOF makes later openers rescan the same suffix.
static bool
posix_regex_scan_payload(TSLexer *lexer, const PosixRegexCompound *compound) {
  uint32_t count = 0;
  int32_t first = 0;
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t character = lexer->lookahead;
    lexer->advance(lexer, false);
    if (character == compound->terminator && lexer->lookahead == ']')
      break;
    if (count == 0)
      first = character;
    count += 1;
    lexer->mark_end(lexer);
  }
  if (count == 0)
    return false;
  if (count > 1)
    lexer->result_symbol = compound->multi;
  else if (compound->allows_meta && posix_regex_is_meta_character(first))
    lexer->result_symbol = COLLATING_SYMBOL_META;
  else
    lexer->result_symbol = compound->single;
  return true;
}

static bool posix_regex_scan_trailing_hyphen(TSLexer *lexer) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead != ']')
    return false;
  lexer->result_symbol = TRAILING_BRACKET_HYPHEN;
  return true;
}

#if POSIX_REGEX_MODE == 0
static bool posix_regex_scan_right_anchor(TSLexer *lexer) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (!lexer->eof(lexer))
    return false;
  lexer->result_symbol = BRE_RIGHT_ANCHOR;
  return true;
}
#endif

static bool posix_regex_scan(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[ERROR_SENTINEL] || lexer->eof(lexer))
    return false;
  if (valid_symbols[BRACKET_OPEN_CHARACTER] && lexer->lookahead == '[') {
    lexer->advance(lexer, false);
    int32_t next = lexer->lookahead;
    if (next == '.' || next == '=' || next == ':')
      return false;
    lexer->result_symbol = BRACKET_OPEN_CHARACTER;
    return true;
  }
  if (valid_symbols[TRAILING_BRACKET_HYPHEN] && lexer->lookahead == '-')
    return posix_regex_scan_trailing_hyphen(lexer);
#if POSIX_REGEX_MODE == 0
  if (valid_symbols[BRE_RIGHT_ANCHOR] && lexer->lookahead == '$')
    return posix_regex_scan_right_anchor(lexer);
#endif
  for (
    unsigned index = 0;
    index < sizeof(posix_regex_compounds) / sizeof(posix_regex_compounds[0]);
    index += 1
  ) {
    const PosixRegexCompound *compound = &posix_regex_compounds[index];
    if (
      valid_symbols[compound->single] ||
      valid_symbols[compound->multi] ||
      (compound->allows_meta && valid_symbols[COLLATING_SYMBOL_META])
    )
      return posix_regex_scan_payload(lexer, compound) &&
        valid_symbols[lexer->result_symbol];
  }
  return false;
}

#define REGEX_SCANNER(suffix) REGEX_SCANNER_ENTRY(POSIX_REGEX_LANGUAGE, suffix)

void *REGEX_SCANNER(create)(void) {
  return NULL;
}

void REGEX_SCANNER(destroy)(void *payload) {
  (void)payload;
}

bool REGEX_SCANNER(scan)(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;
  return posix_regex_scan(lexer, valid_symbols);
}

unsigned REGEX_SCANNER(serialize)(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void REGEX_SCANNER(deserialize)(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}

#endif
