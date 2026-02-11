# Contributing

We welcome contributions to Vesta Launcher! This guide provides detailed workflows for contributing code, documentation, and other improvements.

## Getting Started

### Development Environment Setup
1. **Prerequisites**: Install Rust, Bun, and Java as described in `DEVELOPMENT.md`
2. **Clone Repository**: `git clone https://github.com/your-org/vesta-launcher.git`
3. **Install Dependencies**: `bun install`
4. **Verify Setup**: `bun run vesta:dev` should start the development environment

### Branching Strategy
- **Main Branch**: `main` - Production-ready code
- **Development**: `dev` - Integration branch for features
- **Feature Branches**: `feature/description` or `fix/issue-number`
- **Release Branches**: `release/v1.x.x` - For stable releases

## Contribution Workflow

### 1. Choose an Issue
- Check the [Issues](https://github.com/your-org/vesta-launcher/issues) for open tasks
- Look at `docs/TASKS.md` for documentation work
- Comment on issues to claim them

### 2. Create Feature Branch
```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### 3. Implement Changes
- **Code Style**: Follow the conventions in `docs/development/vesta_preferences.md`
- **Testing**: Write tests for new functionality
- **Documentation**: Update docs for any user-facing changes

### 4. Testing
- **Unit Tests**: `cargo test -p piston-lib --lib`
- **Integration Tests**: `cargo test` in appropriate directories
- **Frontend Tests**: `bun run test` in `vesta-launcher/`
- **Manual Testing**: Test the full application flow

### 5. Commit Changes
```bash
git add .
git commit -m "feat: add new feature

- Description of changes
- Related issue: #123
- Breaking changes: none"
```

Use conventional commit format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Testing
- `chore:` - Maintenance

### 6. Push and Create PR
```bash
git push origin feature/your-feature-name
```
Create a pull request with:
- Clear title and description
- Screenshots for UI changes
- Test results
- Breaking changes noted

## Code Guidelines

### Rust (Backend)
- Use `anyhow::Result` for error handling
- Follow standard Rust naming conventions
- Add documentation comments for public APIs
- Use `cargo fmt` and `cargo clippy`

### TypeScript/SolidJS (Frontend)
- Use TypeScript for all new code
- Follow the existing component patterns
- Use SolidJS best practices for reactivity
- Run `bunx biome check --apply .` for formatting

### Database Changes
- Use Diesel migrations for schema changes
- Test migrations on clean databases
- Document breaking changes in `MIGRATION_GUIDE.md`

## Review Process

### Pull Request Requirements
- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes without migration
- [ ] PR description includes:
  - What changed
  - Why it changed
  - How to test
  - Screenshots/videos if UI-related

### Review Checklist
- [ ] Code quality and readability
- [ ] Test coverage
- [ ] Performance implications
- [ ] Security considerations
- [ ] Documentation accuracy
- [ ] Breaking changes documented

## Areas for Contribution

### Code Contributions
- **Bug Fixes**: Check issues labeled "bug"
- **Features**: Look for "enhancement" issues
- **Performance**: Optimization opportunities
- **Accessibility**: Improve keyboard navigation, screen reader support

### Documentation
- **User Guides**: Improve setup and usage docs
- **API Documentation**: Document Rust/TS APIs
- **Troubleshooting**: Add common issue solutions
- **Architecture**: Document design decisions

### Testing
- **Unit Tests**: Increase test coverage
- **Integration Tests**: Test full workflows
- **UI Tests**: Add component tests
- **Performance Tests**: Benchmark critical paths

### Translation
- **Localization**: Add support for new languages
- **String Extraction**: Help maintain translation files

## Communication

### Discord/Forum
- Join our community for discussions
- Ask questions in appropriate channels
- Share work-in-progress for feedback

### Issue Reporting
- Use issue templates
- Provide reproduction steps
- Include system information
- Attach logs when possible

## Recognition

Contributors are recognized through:
- GitHub contributor statistics
- Changelog entries
- Community shoutouts
- Potential future contributor program

## Notes for Maintainers

### Merging PRs
- Squash merge feature branches
- Use "Rebase and merge" for clean history
- Delete merged branches

### Release Process
- Update version in `package.json` and `Cargo.toml`
- Generate changelog
- Create GitHub release
- Update documentation

### Database Migrations
- Generate new migrations: `diesel migration generate <name>`
- Run migrations: Automatic on app startup
- Test migrations on clean databases

### Breaking Changes
- Document in PR description
- Update migration guide
- Consider deprecation warnings
- Communicate to users

Thank you for contributing to Vesta Launcher! 🚀
