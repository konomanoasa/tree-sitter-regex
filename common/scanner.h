#ifndef REGEX_SCANNER_H
#define REGEX_SCANNER_H

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

static inline bool regex_is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
}

static inline bool regex_is_octal_digit(int32_t character) {
  return character >= '0' && character <= '7';
}

static inline bool regex_is_hexadecimal_digit(int32_t character) {
  return regex_is_ascii_digit(character) ||
    (character >= 'A' && character <= 'F') ||
    (character >= 'a' && character <= 'f');
}

static inline uint32_t regex_hexadecimal_value(int32_t character) {
  return character <= '9' ? (uint32_t)(character - '0')
                          : (uint32_t)((character | 32) - 'a' + 10);
}

static inline bool regex_is_ascii_letter(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z');
}

static inline bool
regex_scan_interval_tail(TSLexer *lexer, bool require_minimum) {
  bool has_minimum = false;
  while (!lexer->eof(lexer) && regex_is_ascii_digit(lexer->lookahead)) {
    has_minimum = true;
    lexer->advance(lexer, false);
  }
  if (require_minimum && !has_minimum)
    return false;
  if (!lexer->eof(lexer) && lexer->lookahead == '}')
    return has_minimum;
  if (lexer->eof(lexer) || lexer->lookahead != ',')
    return false;
  lexer->advance(lexer, false);
  while (!lexer->eof(lexer) && regex_is_ascii_digit(lexer->lookahead))
    lexer->advance(lexer, false);
  return !lexer->eof(lexer) && lexer->lookahead == '}';
}

static inline bool regex_scan_hexadecimal_digits(
  TSLexer *lexer,
  unsigned length,
  uint32_t *value
) {
  uint32_t result = 0;
  for (unsigned index = 0; index < length; index++) {
    if (lexer->eof(lexer) || !regex_is_hexadecimal_digit(lexer->lookahead))
      return false;
    result = result * 16 + regex_hexadecimal_value(lexer->lookahead);
    lexer->advance(lexer, false);
  }
  if (value != NULL)
    *value = result;
  return true;
}

#endif
