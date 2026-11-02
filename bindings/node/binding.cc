#include <napi.h>

struct TSLanguage;
extern "C" const TSLanguage *tree_sitter_ecmaregex();
extern "C" const TSLanguage *tree_sitter_ecmaregex_u();
extern "C" const TSLanguage *tree_sitter_ecmaregex_v();
extern "C" const TSLanguage *tree_sitter_pcre2();
extern "C" const TSLanguage *tree_sitter_posix_bre();
extern "C" const TSLanguage *tree_sitter_posix_ere();
extern "C" const TSLanguage *tree_sitter_pyregex();
extern "C" const TSLanguage *tree_sitter_pyregex_verbose();

namespace {

constexpr napi_type_tag language_type_tag = {
  0x8AF2E5212AD58ABF,
  0xD5006CAD83ABBA16
};

struct Grammar {
  const char *name;
  const TSLanguage *(*language)();
};

constexpr Grammar grammars[] = {
  {"ecmaregex", tree_sitter_ecmaregex},
  {"ecmaregex_u", tree_sitter_ecmaregex_u},
  {"ecmaregex_v", tree_sitter_ecmaregex_v},
  {"pcre2", tree_sitter_pcre2},
  {"posix_bre", tree_sitter_posix_bre},
  {"posix_ere", tree_sitter_posix_ere},
  {"pyregex", tree_sitter_pyregex},
  {"pyregex_verbose", tree_sitter_pyregex_verbose}
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  for (const auto &grammar : grammars) {
    auto language = Napi::External<TSLanguage>::New(
      env,
      const_cast<TSLanguage *>(grammar.language())
    );
    language.TypeTag(&language_type_tag);
    auto binding = Napi::Object::New(env);
    binding["language"] = language;
    exports[grammar.name] = binding;
  }
  return exports;
}

}

NODE_API_MODULE(tree_sitter_regex_binding, Init)
