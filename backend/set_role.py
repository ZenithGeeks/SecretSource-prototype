"""Set the role a person lands in after signing in, on a browser with no role remembered.

    docker compose exec gateway python set_role.py someone@example.com labeler

The role goes in the account's app_metadata, which only the service role can write. It picks
where the person lands; any signed-in user can still open every role.
"""

import argparse
import sys

from app import auth, store

ROLES = ("researcher", "writer", "teacher", "labeler")  # frontend/src/lib/roles.ts


def set_role(email: str, role: str) -> str:
    """Write `role` to the account's app_metadata and return the user id.

    Raises:
        LookupError: no confirmed account signs in with this email.
    """
    user_id = auth._user_id_for_email(email.strip().lower())
    if user_id is None:
        raise LookupError(f"no confirmed SecretSource account signs in as {email}")
    # Supabase merges app_metadata keys, so the provider fields stay.
    store._supabase().auth.admin.update_user_by_id(user_id, {"app_metadata": {"role": role}})
    return user_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("email")
    parser.add_argument("role", choices=ROLES)
    args = parser.parse_args()
    try:
        user_id = set_role(args.email, args.role)
    except LookupError as error:
        sys.exit(str(error))
    print(f"{args.email} ({user_id}) now lands in {args.role}")


if __name__ == "__main__":
    main()
