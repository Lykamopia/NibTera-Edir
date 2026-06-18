
import type {NextConfig} from 'next';
import dotenv from 'dotenv';

dotenv.config();

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true, // Allow local images to work without optimization issues
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.brandfetch.io',
        port: '',
        pathname: '/id3xwknDM-/**',
      }
    ],
  },
};

export default nextConfig;
