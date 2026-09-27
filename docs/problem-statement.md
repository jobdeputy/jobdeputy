# Problem statement

## Problem

Job seekers discover opportunities across LinkedIn and many separate company websites, such as Amazon Careers, Google Careers, etc. Each source exposes jobs differently, forcing users to repeat searches, open and review many pages manually, compare each role with their experience and preferences, customize application materials, and track promising opportunities.

Existing job-search automations commonly solve only part of this problem. They are often tied to one platform, rely on hard-coded search behavior, provide generic application materials, or require the product owner to provide and pay for shared third-party API and AI credentials. These limitations make the automation difficult to extend, costly to operate, and unsuitable for users who want control over their credentials and data.

JobDeputy needs to provide a consistent, extensible workflow delivered in two phases.

## Phase 1: Job discovery and application preparation

The first phase needs to:

- Discover relevant jobs from LinkedIn.
- Accept user-provided URLs so discovery is not limited to built-in platform integrations.
- Support additional job platforms and company career sites without coupling the product to LinkedIn.
- Extract and normalize useful job information from supported sources.
- Evaluate and rank jobs according to each user's résumé, experience, skills, and preferences.
- Generate job-specific application materials, including a tailored résumé or CV and cover letter.
- Save discovered jobs and their generated application materials.
- Present the saved jobs and materials to the user for review and management.

## Phase 2: Job application automation

The second phase will reduce the remaining repetitive work by automating job applications using the jobs and application materials prepared in Phase 1. Application automation must remain traceable and under the user's control.

## Cross-phase requirement

JobDeputy will use a Bring Your Own Token (BYOT) model, allowing each user to supply and control the credentials required for supported AI models and external services.
