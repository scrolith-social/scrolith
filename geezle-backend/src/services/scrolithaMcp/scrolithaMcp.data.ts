import prisma from '../../utils/prismaClient';
import type { McpDataSource, McpSearchInput } from './scrolithaMcp.types';

export type { McpDataSource, McpSearchInput } from './scrolithaMcp.types';

const clip = (value: unknown, max = 2_000) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const publicUser = (user: any) => ({
  id: user.id,
  name: user.name || null,
  avatar: user.avatar || null
});

const publicJob = (job: any) => ({
  id: job.id,
  title: job.title,
  description: clip(job.description),
  budget: job.budget || null,
  type: job.type,
  postedTime: job.postedTime,
  tags: Array.isArray(job.tags) ? job.tags.slice(0, 50) : [],
  experienceLevel: job.experienceLevel || null,
  duration: job.duration || null,
  client: job.client ? publicUser(job.client) : null
});

const publicGig = (gig: any) => ({
  id: gig.id,
  title: gig.title,
  slug: gig.slug,
  description: clip(gig.description),
  price: gig.price,
  deliveryTime: gig.deliveryTime,
  revisions: gig.revisions,
  categoryId: gig.categoryId || null,
  tags: Array.isArray(gig.tags) ? gig.tags.slice(0, 50) : [],
  images: Array.isArray(gig.images) ? gig.images.slice(0, 10) : [],
  rating: gig.rating,
  reviewCount: gig.reviewCount,
  seller: gig.user ? publicUser(gig.user) : null
});

const textFilter = (query?: string) => {
  const normalized = String(query || '').trim();
  if (!normalized) return {};
  return {
    OR: [
      { title: { contains: normalized, mode: 'insensitive' as const } },
      { description: { contains: normalized, mode: 'insensitive' as const } },
      { tags: { has: normalized } }
    ]
  };
};

const paginate = (items: unknown[], limit: number, offset: number) => ({
  items: items.slice(0, limit),
  nextOffset: items.length > limit ? offset + limit : null
});

export const prismaMcpDataSource: McpDataSource = {
  async getMyProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        profile: {
          select: {
            title: true,
            bio: true,
            skills: true,
            experience: true,
            education: true,
            languages: true,
            portfolioUrl: true,
            githubUrl: true,
            linkedinUrl: true,
            websiteUrl: true
          }
        }
      }
    });

    if (!user || user.isActive === false) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      profile: user.profile
        ? {
            ...user.profile,
            bio: clip(user.profile.bio, 4_000),
            skills: user.profile.skills.slice(0, 100),
            languages: user.profile.languages.slice(0, 50)
          }
        : null
    };
  },

  async searchJobs(_userId, input) {
    const jobs = await prisma.job.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
        isVisible: true,
        visibility: 'PUBLIC',
        adminStatus: 'APPROVED',
        ...textFilter(input.query)
      },
      orderBy: [{ postedTime: 'desc' }, { id: 'desc' }],
      skip: input.offset,
      take: input.limit + 1,
      select: {
        id: true,
        title: true,
        description: true,
        budget: true,
        type: true,
        postedTime: true,
        tags: true,
        experienceLevel: true,
        duration: true,
        client: { select: { id: true, name: true, avatar: true } }
      }
    });
    return paginate(jobs.map(publicJob), input.limit, input.offset);
  },

  async getJobDetails(_userId, jobId) {
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        status: 'ACTIVE',
        isActive: true,
        isVisible: true,
        visibility: 'PUBLIC',
        adminStatus: 'APPROVED'
      },
      select: {
        id: true,
        title: true,
        description: true,
        budget: true,
        type: true,
        postedTime: true,
        tags: true,
        experienceLevel: true,
        duration: true,
        client: { select: { id: true, name: true, avatar: true } }
      }
    });
    return job ? publicJob(job) : null;
  },

  async searchGigs(_userId, input) {
    const gigs = await prisma.gig.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
        adminStatus: 'APPROVED',
        ...textFilter(input.query)
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: input.offset,
      take: input.limit + 1,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        price: true,
        deliveryTime: true,
        revisions: true,
        categoryId: true,
        tags: true,
        images: true,
        rating: true,
        reviewCount: true,
        user: { select: { id: true, name: true, avatar: true } }
      }
    });
    return paginate(gigs.map(publicGig), input.limit, input.offset);
  },

  async getGigDetails(_userId, gigId) {
    const gig = await prisma.gig.findFirst({
      where: { id: gigId, status: 'ACTIVE', isActive: true, adminStatus: 'APPROVED' },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        price: true,
        deliveryTime: true,
        revisions: true,
        categoryId: true,
        tags: true,
        images: true,
        rating: true,
        reviewCount: true,
        user: { select: { id: true, name: true, avatar: true } }
      }
    });
    return gig ? publicGig(gig) : null;
  }
};
