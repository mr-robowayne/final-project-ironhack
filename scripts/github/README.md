# 1. VOR dem Script: Prüfungen
head -1 ansible/group_vars/vault.yml  # Muss "$ANSIBLE_VAULT" zeigen!

# 2. Optional: .gitignore fixen
echo "*.bak" >> .gitignore

# 3. Repo erstellen (macht automatisch setup-all.sh)
./scripts/github/git-create-repo.sh
# → Fragt nach ANSIBLE_VAULT_PASS
# → Erstellt Environments, Secrets, Variables

# 4. Development Branch erstellen
git checkout -b development
git push -u origin development

# 5. CloudFront ID nachtragen (wenn Distribution existiert)
gh secret set CLOUDFRONT_DISTRIBUTION_ID -R mr-robowayne/patientsync

# 6. OIDC Trust Policy prüfen (in AWS Console)
# → repo:mr-robowayne/patientsync:* muss in beiden IAM Rollen stehen

# 7. Pipelines testen
git checkout development
git commit --allow-empty -m "test: trigger pipelines"
git push
