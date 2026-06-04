/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      const path = require("path");
      const week4Path = path.resolve(__dirname, "..", "week4");

      for (const rule of config.module.rules) {
        if (
          rule.test &&
          (rule.test.toString().includes("tsx") ||
            rule.test.toString().includes("ts"))
        ) {
          if (!rule.include) {
            rule.include = [];
          }
          if (Array.isArray(rule.include)) {
            rule.include.push(week4Path);
          } else {
            rule.include = [rule.include, week4Path];
          }
        }
      }
    }
    return config;
  },

  experimental: {
    esmExternals: "loose",
  },
};

module.exports = nextConfig;
