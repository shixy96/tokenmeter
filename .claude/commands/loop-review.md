---
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git add:*), Read, Edit, Write, Skill, Task, AskUserQuestion
description: Iteratively review and optimize staged code for bugs, logic issues, and code standards compliance
---

## Context

- Git staged status: `git status`
- Staged code changes: `git diff --staged`
- Project code standards: @CLAUDE.md @AGENTS.md

## Task

Iteratively review and optimize git staged code until no further improvements are needed.

### Loop through the following steps:

#### Step 1: Code Review (Parallel Execution)

**Use multiple subagents to review code in parallel**, with each subagent focusing on specific aspects. All subagent calls must be initiated in a single message.

**Approach 1: Parallel by Review Type**
Launch multiple `code-reviewer` subagents simultaneously, each focusing on different review dimensions:

1. **Logic/Functional Bugs Review** (1-2 subagents)
   - Code logic errors
   - Improper boundary condition handling
   - Missing null/exception handling
   - Type safety issues

2. **Code Standards Review** (1-2 subagents)
   - Compliance with project code standards (CLAUDE.md/AGENTS.md)
   - Adherence to design principles: KISS, DRY, SOLID (especially Open/Closed), YAGNI
   - Correct architectural layering and separation of concerns
   - Consistent use of project's style system (variables, tokens, utilities)
   - Absence of forbidden patterns as defined in project standards
   - Comment quality: remove low-value comments that restate code, keep "why" explanations

3. **Optimization Opportunities Review** (1-2 subagents)
   - Duplicate code
   - Simplifiable logic
   - Performance improvements

**Approach 2: Parallel by File/Module**
If changes involve multiple independent files or modules, launch separate subagents to conduct comprehensive reviews for each file/module.

**Execution Requirements**:

- All subagents must be launched in parallel using multiple Task tool calls in a **single message**
- Wait for all subagents to complete, then consolidate all findings
- Prioritize issues by severity and impact scope

#### Step 2: Propose Improvements

List specific improvement suggestions based on review results. Each suggestion should include:

- Problem description
- Improvement solution
- Impact scope

#### Step 3: User Confirmation

Before executing code modifications, present improvement suggestions to the user and obtain confirmation:

1. Use the AskUserQuestion tool to present:
   - List of discovered issues
   - Proposed fix for each issue
   - Expected impact scope

2. Wait for user confirmation before proceeding to Step 4

3. If the user rejects or requests adjustments:
   - Modify improvement suggestions based on user feedback
   - Request confirmation again

#### Step 4: Execute Code Optimization

Modify code based on improvement suggestions:

- Fix discovered bugs
- Optimize code structure
- Ensure compliance with code standards

#### Step 5: Code Simplification

Use `code-simplifier:code-simplifier` subagent to simplify the modified code, ensuring clarity and conciseness.

#### Step 6: Verification

Automatically detect and execute appropriate type checking and lint commands based on the project's tech stack.

### Loop Termination Conditions

Stop looping when ALL of the following conditions are met:

- No new bugs discovered
- No code standard violations
- No obvious optimization opportunities
- All checks pass

### Output Requirements

After each loop iteration, output:

1. Number of issues found in this iteration
2. List of fixed issues
3. Whether another iteration is needed

Final output:

- Total number of iterations executed
- Summary of all modifications
- Final code quality assessment
