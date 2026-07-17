#!/usr/bin/env ruby
# frozen_string_literal: true

# What does Jekyll ACTUALLY read? (#17, #18)
#
# The companion to psych-oracle.rb, and the same rule: the JS side is not an
# oracle for Jekyll, so `src/layout/`'s fence is only ever as good as a real
# build's verdict. Unlike the Psych oracle this does NOT run in CI — Ruby ships
# on the runner but Jekyll is a gem install, and every rule the fence relies on
# is one both supported versions already agree about. It is committed so the
# measurement is reproducible instead of living in someone's scratch directory:
# the first time #17's findings had to be re-checked against 3.10, the fixtures
# that proved them were gone and had to be rebuilt from nothing.
#
# Run it when `src/layout/` changes, or when GitHub Pages moves off Jekyll 3.10:
#
#   gem install jekyll -v 3.10.0    # what GitHub Pages runs (github-pages gem)
#   gem install jekyll -v 4.4.1     # what an Actions build may pin
#   ruby test/oracle/jekyll-layout-oracle.rb            # both versions
#   ruby test/oracle/jekyll-layout-oracle.rb 3.10.0     # just one
#
# Each fixture prints the posts Jekyll read. Compare against the tables in
# docs/DESIGN.md; a diff there is a fence bug (or a Jekyll release worth knowing
# about). GitHub Pages' current version: https://pages.github.com/versions/

require 'fileutils'
require 'tmpdir'
require 'open3'

VERSIONS = ARGV.empty? ? %w[3.10.0 4.4.1] : ARGV

# Each fixture: a _config.yml and a set of post paths. The expectations are in
# the comments rather than asserted here — this reports what Jekyll does, and a
# human compares it to what src/layout/ believes. An oracle that asserted our
# expectations could only ever confirm them.
FIXTURES = {
  'recursion: _posts is read at any depth, with NO config' => {
    config: "\n",
    files: %w[
      _posts/2026-01-01-root.md
      blog/_posts/2026-01-02-nested.md
      deep/nested/very/_posts/2026-01-03-deep.md
      deep/nested/very/_drafts/deep-draft.md
      _drafts/root-draft.md
    ],
  },
  'collections_dir moves BOTH _posts and _drafts; root copies ignored' => {
    config: "collections_dir: content\n",
    files: %w[
      _posts/2026-01-01-root-ignored.md
      _drafts/root-draft-ignored.md
      content/_posts/2026-02-02-moved.md
      content/_drafts/moved-draft.md
      content/blog/_posts/2026-02-03-nested.md
      blog/_posts/2026-02-04-outside-ignored.md
    ],
  },
  'the fence: _ and . prune; include: re-opens; exclude globs prune' => {
    config: "exclude:\n  - \"glob-*\"\ninclude:\n  - \"_included\"\n",
    files: %w[
      _posts/2026-01-01-root.md
      _underscore/_posts/2026-01-02-us.md
      .hidden/_posts/2026-01-03-hid.md
      _included/_posts/2026-01-04-inc.md
      glob-thing/_posts/2026-01-05-g.md
    ],
  },
  # The reason src/layout/ ignores Jekyll's built-in default excludes: whether
  # they apply at all depends on the version AND on whether the user wrote an
  # exclude: key. 3.10 REPLACES the defaults; 4.x merges them (add_default_excludes).
  'default excludes, NO user exclude: key' => {
    config: "\n",
    files: %w[_posts/2026-01-01-root.md node_modules/_posts/2026-01-02-nm.md],
  },
  'default excludes, user SETS an unrelated exclude: key' => {
    config: "exclude:\n  - unrelated-dir\n",
    files: %w[_posts/2026-01-01-root.md node_modules/_posts/2026-01-02-nm.md],
  },
  # exclude patterns are root-anchored globs matched against the source-relative
  # path, so a nested node_modules is NOT pruned by the bare `node_modules` entry.
  'exclude is root-anchored: nested node_modules is still walked' => {
    config: "\n",
    files: %w[
      node_modules/_posts/2026-01-01-nm-root.md
      blog/node_modules/_posts/2026-01-02-nm-nested.md
      vendor/_posts/2026-01-03-vendor-bare.md
      vendor/bundle/_posts/2026-01-04-vendor-bundle.md
    ],
  },
}.freeze

DUMP = <<~RUBY
  Jekyll::Hooks.register :site, :post_read do |site|
    puts "    effective exclude: \#{site.config['exclude'].inspect}"
    puts "    collections_path:  \#{site.collections_path.sub(Dir.pwd, '.')}"
    site.posts.docs.each { |d| puts "    READ: \#{d.relative_path}" }
  end
RUBY

def build(version, fixture)
  Dir.mktmpdir do |dir|
    File.write(File.join(dir, '_config.yml'), fixture[:config])
    FileUtils.mkdir_p(File.join(dir, '_plugins'))
    File.write(File.join(dir, '_plugins', 'dump.rb'), DUMP)
    fixture[:files].each do |rel|
      path = File.join(dir, rel)
      FileUtils.mkdir_p(File.dirname(path))
      File.write(path, "---\ntitle: #{File.basename(rel, '.md')}\n---\nbody\n")
    end
    out, status = Open3.capture2e(
      'jekyll', "_#{version}_", 'build', '--drafts', '--quiet', chdir: dir
    )
    return "    !! jekyll #{version} failed:\n#{out}" unless status.success?

    out.lines.reject { |l| l.strip.empty? }.join
  end
end

VERSIONS.each do |version|
  puts "\n#{'=' * 72}\nJekyll #{version}\n#{'=' * 72}"
  FIXTURES.each do |name, fixture|
    puts "\n--- #{name}"
    puts build(version, fixture)
  end
end
