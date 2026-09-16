import type { ImageMetadata } from 'astro';
import openProcessingLogo from '../images/openprocessing_logo.svg';
import butterLogo from '../images/butter_logo.svg';

export interface Sponsor {
  name: string;
  href: string;
  logo: ImageMetadata;
}

export const SPONSORS: Sponsor[] = [
  {
    name: 'OpenProcessing',
    href: 'https://openprocessing.org',
    logo: openProcessingLogo,
  },
  {
    name: 'Butter',
    href: 'https://www.butter.video/',
    logo: butterLogo,
  },
];
