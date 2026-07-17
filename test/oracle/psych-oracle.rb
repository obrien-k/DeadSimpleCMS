# The oracle for "what does Jekyll actually read?"
#
#   ruby psych-oracle.rb <file.yml>   -> JSON: { key => [inspect, class] }
#
# Exists because the JS `yaml` library is NOT an oracle for Jekyll, even in
# version:'1.1' mode: both call themselves YAML 1.1, but they disagree (the JS
# lib treats `y`/`n` as booleans; Psych does not). Asking the JS reader whether
# the JS writer produced safe output is circular — it only ever proves the
# library agrees with itself. Jekyll parses with Psych, so Psych answers.
#
# Matches Jekyll's own call: SafeYAML with Date/Time permitted.

require "yaml"
require "json"
require "date"

begin
  loaded = YAML.safe_load_file(ARGV[0], permitted_classes: [Date, Time])
  puts JSON.dump(loaded.transform_values { |v| [v.inspect, v.class.to_s] })
rescue => e
  puts JSON.dump({ "__error__" => ["#{e.class}: #{e.message}", "Error"] })
end
