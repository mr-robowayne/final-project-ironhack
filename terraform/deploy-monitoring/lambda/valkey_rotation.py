import json
import os
import random
import string
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

secrets = boto3.client("secretsmanager")
elasticache = boto3.client("elasticache")
sns = boto3.client("sns")

SECRET_ARN = os.environ.get("SECRET_ARN")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN")
WARN_DAYS = int(os.environ.get("WARN_DAYS", "5"))


def _publish(subject: str, message: str) -> None:
    if not SNS_TOPIC_ARN:
        return
    sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject[:100], Message=message)


def _generate_token(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(random.SystemRandom().choice(alphabet) for _ in range(length))


def _describe_secret(secret_id: str) -> dict:
    return secrets.describe_secret(SecretId=secret_id)


def _get_secret_payload(secret_id: str, version_stage: str = "AWSCURRENT", token: str = None) -> dict:
    kwargs = {"SecretId": secret_id}
    if token:
        kwargs["VersionId"] = token
        kwargs["VersionStage"] = version_stage
    else:
        kwargs["VersionStage"] = version_stage

    value = secrets.get_secret_value(**kwargs)
    return json.loads(value["SecretString"])


def _put_pending_secret(secret_id: str, token: str, payload: dict) -> None:
    secrets.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=json.dumps(payload),
        VersionStages=["AWSPENDING"],
    )


def _find_replication_group_id(hostname: str) -> str:
    paginator = elasticache.get_paginator("describe_replication_groups")
    for page in paginator.paginate():
        for group in page.get("ReplicationGroups", []):
            node_groups = group.get("NodeGroups", [])
            for node_group in node_groups:
                primary = node_group.get("PrimaryEndpoint")
                if primary and primary.get("Address") == hostname:
                    return group["ReplicationGroupId"]
            configuration_endpoint = group.get("ConfigurationEndpoint")
            if configuration_endpoint and configuration_endpoint.get("Address") == hostname:
                return group["ReplicationGroupId"]
    raise ValueError(f"Could not map hostname '{hostname}' to a replication group.")


def _set_secret(secret_id: str, token: str) -> None:
    current = _get_secret_payload(secret_id, version_stage="AWSCURRENT")
    pending = _get_secret_payload(secret_id, version_stage="AWSPENDING", token=token)

    if current.get("auth_token") == pending.get("auth_token"):
        return

    replication_group_id = _find_replication_group_id(pending["host"])
    elasticache.modify_replication_group(
        ReplicationGroupId=replication_group_id,
        AuthToken=pending["auth_token"],
        AuthTokenUpdateStrategy="ROTATE",
        ApplyImmediately=True,
    )


def _finish_secret(secret_id: str, token: str) -> None:
    metadata = _describe_secret(secret_id)
    current_version = None
    for version, stages in metadata.get("VersionIdsToStages", {}).items():
        if "AWSCURRENT" in stages:
            current_version = version
            break

    secrets.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )


def _reminder(secret_id: str, days_before: int) -> None:
    metadata = _describe_secret(secret_id)
    next_rotation = metadata.get("NextRotationDate")
    if next_rotation is None:
        return

    now = datetime.now(timezone.utc)
    days_remaining = (next_rotation - now).days
    if days_remaining <= days_before:
        _publish(
            subject="Valkey Secret Rotation Reminder",
            message=(
                f"Secret {secret_id} rotates in {days_remaining} day(s). "
                f"Next rotation date: {next_rotation.isoformat()}"
            ),
        )


def lambda_handler(event, _context):
    secret_id = event.get("SecretId", SECRET_ARN)
    if not secret_id:
        raise ValueError("SecretId is required.")

    if event.get("action") == "reminder":
        days_before = int(event.get("days_before", WARN_DAYS))
        _reminder(secret_id, days_before)
        return {"status": "reminder_checked"}

    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = _describe_secret(secret_id)
    versions = metadata.get("VersionIdsToStages", {})
    if token not in versions:
        raise ValueError("Secret version not found.")
    if "AWSCURRENT" in versions[token]:
        return {"status": "already_current"}
    if "AWSPENDING" not in versions[token]:
        raise ValueError("Secret version is not marked as AWSPENDING.")

    try:
        if step == "createSecret":
            current = _get_secret_payload(secret_id, version_stage="AWSCURRENT")
            new_payload = dict(current)
            new_payload["auth_token"] = _generate_token()
            _put_pending_secret(secret_id, token, new_payload)
        elif step == "setSecret":
            _set_secret(secret_id, token)
        elif step == "testSecret":
            _get_secret_payload(secret_id, version_stage="AWSPENDING", token=token)
        elif step == "finishSecret":
            _finish_secret(secret_id, token)
            _publish(
                subject="Valkey Secret Rotation Succeeded",
                message=f"Valkey secret rotation finished successfully for {secret_id}.",
            )
        else:
            raise ValueError(f"Invalid Step parameter: {step}")
    except ClientError as exc:
        _publish(
            subject="Valkey Secret Rotation Failed",
            message=f"Valkey secret rotation failed for {secret_id}. Error: {exc}",
        )
        raise

    return {"status": "ok", "step": step}
